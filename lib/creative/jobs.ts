import { createHash } from "node:crypto";
import { type Sql, RUNTIME_DDL } from "@/lib/db";

// The durable creative job — the link between a Populr creative request, a provider task,
// and the asset that (only sometimes) results.
//
// Why this exists next to lib/jobs/ rather than inside it. The Job Engine is genuinely
// good at what it does: event-sourced history, a state machine, retries, a worker pool.
// But two of its properties make it the wrong home for a paid, minutes-long external call:
//
//   1. Its queue is in-memory (QueueManager.dequeue), and /api/jobs does `void
//      engine.drain()` after responding. That is fine for stages that are synchronous CPU
//      work. A task that is submitted now and answered in three minutes has no process to
//      come back to on a serverless platform.
//   2. Its idempotency map is in-memory too (JobEngine.idem). Two concurrent requests that
//      land on two lambdas both miss it and both create a job. For free work that is a
//      duplicate row; for video generation it is a duplicate charge.
//
// So the provider relationship lives in Postgres, where a UNIQUE constraint can be relied
// on across processes, and the Job Engine keeps doing the orchestration it is good at. The
// two are linked by job_id rather than merged.

export const CREATIVE_STATES = [
  "queued",       // accepted, nothing sent anywhere yet
  "preparing",    // brief + storyboard being assembled
  "submitted",    // provider accepted the task and gave us a task id
  "running",      // provider reports work in progress
  "downloading",  // provider finished; we are fetching the bytes before the url expires
  "validating",   // bytes in hand, being checked and stored
  "ready",        // a stored, validated asset exists — see the invariant below
  "failed",
  "cancelled",
] as const;
export type CreativeState = (typeof CREATIVE_STATES)[number];

export const TERMINAL_CREATIVE_STATES: CreativeState[] = ["ready", "failed", "cancelled"];

/**
 * The invariant, in code.
 *
 * "ready" is the only state a user is ever shown as success, and it requires an asset id.
 * A provider reporting "succeeded" moves us to `downloading`, not to `ready` — those are
 * different claims, and conflating them is how a product ends up showing a finished video
 * that does not exist.
 */
export function isReady(job: CreativeJob): boolean {
  return job.status === "ready" && !!job.assetId;
}

/**
 * Map a provider's own status onto ours.
 *
 * Unknown statuses map to `running`, never to a terminal state. A provider that invents a
 * new status string must not be able to talk this system into declaring success, and
 * treating the unknown as failure would be equally wrong — it would abandon work that is
 * probably still going. `running` is the honest reading of "we do not recognise this".
 */
export function mapProviderStatus(raw: string): CreativeState {
  switch (raw) {
    case "succeeded": return "downloading";  // NOT ready: the bytes are still on their side
    case "failed": return "failed";
    case "cancelled": return "cancelled";
    case "queued": return "submitted";
    case "running": return "running";
    default: return "running";
  }
}

export type CreativeJob = {
  id: string;
  workspaceKey: string;
  /** The lib/jobs Job driving orchestration, when one is attached. */
  jobId: string | null;
  /** GenerationSpecification id from lib/creative-intelligence. Not the spec itself. */
  specId: string | null;
  provider: string;
  /** The provider's task id, once it has given us one. */
  providerTaskId: string | null;
  status: CreativeState;
  brief: Record<string, unknown> | null;
  storyboard: Record<string, unknown> | null;
  /** media_assets.id. Set only when a real stored asset exists. */
  assetId: string | null;
  error: string | null;
  /** USD, or null when the rate is not configured. Never a guessed number. */
  costEstimate: number | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateCreativeJob = {
  workspaceKey: string;
  idempotencyKey: string;
  provider: string;
  jobId?: string | null;
  specId?: string | null;
  brief?: Record<string, unknown> | null;
  storyboard?: Record<string, unknown> | null;
  costEstimate?: number | null;
};

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

/**
 * The deterministic part of the key: workspace + what is being made.
 *
 * `nonce` is what keeps "Regenerate" working. Two accidental submissions of the same brief
 * — a double click, a retried fetch, a React re-render, a refresh that replays a POST —
 * carry the same nonce and collapse into one job. A person deliberately asking for another
 * take passes a fresh nonce and gets a genuine second generation.
 *
 * Getting this backwards in either direction costs money or trust: a key without a nonce
 * makes regeneration impossible, and a key with a random nonce per request makes the whole
 * guard decorative.
 */
export function idempotencyKeyFor(workspaceKey: string, specHash: string, nonce: string): string {
  return createHash("sha256").update(`${workspaceKey}\n${specHash}\n${nonce}`).digest("hex").slice(0, 48);
}

/** Stable hash of whatever defines the creative. Order-independent for plain objects. */
export function specHashOf(spec: unknown): string {
  return createHash("sha256").update(stable(spec)).digest("hex").slice(0, 32);
}

function stable(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export interface CreativeJobRepo {
  /** Create, or return the existing job for this idempotency key. Never creates twice. */
  create(input: CreateCreativeJob): Promise<{ job: CreativeJob; created: boolean }>;
  get(id: string, workspaceKey: string): Promise<CreativeJob | null>;
  /**
   * Look a job up by the provider's task id.
   *
   * Used only by the webhook, and deliberately without a workspace argument: the caller is
   * a provider callback and has no workspace to offer. The workspace is read off the row
   * that comes back, which is what stops a callback attaching an asset to another tenant.
   */
  findByTask(providerTaskId: string): Promise<CreativeJob | null>;
  update(id: string, patch: Partial<Omit<CreativeJob, "id" | "workspaceKey" | "createdAt">>): Promise<CreativeJob | null>;
  /** Non-terminal jobs untouched since `before` — the sweeper's input. */
  stale(before: number, limit?: number): Promise<CreativeJob[]>;
  list(workspaceKey: string, limit?: number): Promise<CreativeJob[]>;
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `cj_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export class InMemoryCreativeJobRepo implements CreativeJobRepo {
  private rows = new Map<string, CreativeJob>();
  private byIdem = new Map<string, string>();

  async create(input: CreateCreativeJob) {
    const existing = this.byIdem.get(input.idempotencyKey);
    if (existing) return { job: this.rows.get(existing)!, created: false };
    const now = new Date().toISOString();
    const job: CreativeJob = {
      id: newId(), workspaceKey: input.workspaceKey, jobId: input.jobId ?? null,
      specId: input.specId ?? null, provider: input.provider, providerTaskId: null,
      status: "queued", brief: input.brief ?? null, storyboard: input.storyboard ?? null,
      assetId: null, error: null, costEstimate: input.costEstimate ?? null,
      idempotencyKey: input.idempotencyKey, createdAt: now, updatedAt: now,
    };
    this.rows.set(job.id, job);
    this.byIdem.set(job.idempotencyKey, job.id);
    return { job, created: true };
  }

  async get(id: string, workspaceKey: string) {
    const j = this.rows.get(id);
    return j && j.workspaceKey === workspaceKey ? { ...j } : null;
  }

  async findByTask(providerTaskId: string) {
    const j = [...this.rows.values()].find((r) => r.providerTaskId === providerTaskId);
    return j ? { ...j } : null;
  }

  async update(id: string, patch: Partial<CreativeJob>) {
    const j = this.rows.get(id);
    if (!j) return null;
    const next = { ...j, ...patch, updatedAt: new Date().toISOString() };
    this.rows.set(id, next);
    return { ...next };
  }

  async stale(before: number, limit = 50) {
    return [...this.rows.values()]
      .filter((j) => !TERMINAL_CREATIVE_STATES.includes(j.status) && Date.parse(j.updatedAt) < before)
      .slice(0, limit);
  }

  async list(workspaceKey: string, limit = 50) {
    return [...this.rows.values()]
      .filter((j) => j.workspaceKey === workspaceKey)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
}

let ready = false;
async function ensureTable(sql: Sql) {
  if (ready) return;
  if (!RUNTIME_DDL) { ready = true; return; }
  await sql`CREATE TABLE IF NOT EXISTS creative_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_key TEXT NOT NULL,
    job_id TEXT,
    spec_id TEXT,
    provider TEXT NOT NULL,
    provider_task_id TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    brief JSONB,
    storyboard JSONB,
    asset_id UUID,
    error TEXT,
    cost_estimate REAL,
    -- The guard that actually holds. The Job Engine's in-memory map cannot see a request
    -- being handled by another lambda; this constraint can, because there is one database.
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_creative_ws ON creative_jobs (workspace_key, created_at DESC)`;
  // The sweeper's query: non-terminal work, oldest first.
  await sql`CREATE INDEX IF NOT EXISTS idx_creative_stale ON creative_jobs (status, updated_at)`;
  // The webhook's lookup path.
  await sql`CREATE INDEX IF NOT EXISTS idx_creative_task ON creative_jobs (provider_task_id)`;
  ready = true;
}

type Row = {
  id: string; workspace_key: string; job_id: string | null; spec_id: string | null;
  provider: string; provider_task_id: string | null; status: string;
  brief: unknown; storyboard: unknown; asset_id: string | null; error: string | null;
  cost_estimate: number | null; idempotency_key: string; created_at: string; updated_at: string;
};

function toJob(r: Row): CreativeJob {
  return {
    id: r.id, workspaceKey: r.workspace_key, jobId: r.job_id, specId: r.spec_id,
    provider: r.provider, providerTaskId: r.provider_task_id, status: r.status as CreativeState,
    brief: (r.brief as Record<string, unknown>) ?? null,
    storyboard: (r.storyboard as Record<string, unknown>) ?? null,
    assetId: r.asset_id, error: r.error, costEstimate: r.cost_estimate,
    idempotencyKey: r.idempotency_key, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export class NeonCreativeJobRepo implements CreativeJobRepo {
  constructor(private sql: Sql) {}

  async create(input: CreateCreativeJob) {
    await ensureTable(this.sql);
    // ON CONFLICT DO NOTHING, then read back. The insert and the duplicate check are one
    // atomic statement, so two lambdas racing on the same key cannot both win — which is
    // the entire point of putting this in the database rather than in a Map.
    const rows = (await this.sql`
      INSERT INTO creative_jobs (workspace_key, job_id, spec_id, provider, brief, storyboard, cost_estimate, idempotency_key)
      VALUES (${input.workspaceKey}, ${input.jobId ?? null}, ${input.specId ?? null}, ${input.provider},
              ${input.brief ? JSON.stringify(input.brief) : null}::jsonb,
              ${input.storyboard ? JSON.stringify(input.storyboard) : null}::jsonb,
              ${input.costEstimate ?? null}, ${input.idempotencyKey})
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING *`) as Row[];
    if (rows.length) return { job: toJob(rows[0]), created: true };

    const existing = (await this.sql`
      SELECT * FROM creative_jobs WHERE idempotency_key = ${input.idempotencyKey}`) as Row[];
    return { job: toJob(existing[0]), created: false };
  }

  async get(id: string, workspaceKey: string) {
    await ensureTable(this.sql);
    const rows = (await this.sql`
      SELECT * FROM creative_jobs WHERE id = ${id} AND workspace_key = ${workspaceKey}`) as Row[];
    return rows.length ? toJob(rows[0]) : null;
  }

  async findByTask(providerTaskId: string) {
    await ensureTable(this.sql);
    const rows = (await this.sql`
      SELECT * FROM creative_jobs WHERE provider_task_id = ${providerTaskId} LIMIT 1`) as Row[];
    return rows.length ? toJob(rows[0]) : null;
  }

  async update(id: string, patch: Partial<CreativeJob>) {
    await ensureTable(this.sql);
    const rows = (await this.sql`
      UPDATE creative_jobs SET
        status = COALESCE(${patch.status ?? null}, status),
        provider_task_id = COALESCE(${patch.providerTaskId ?? null}, provider_task_id),
        asset_id = COALESCE(${patch.assetId ?? null}::uuid, asset_id),
        error = COALESCE(${patch.error ?? null}, error),
        spec_id = COALESCE(${patch.specId ?? null}, spec_id),
        storyboard = COALESCE(${patch.storyboard ? JSON.stringify(patch.storyboard) : null}::jsonb, storyboard),
        cost_estimate = COALESCE(${patch.costEstimate ?? null}, cost_estimate),
        updated_at = now()
      WHERE id = ${id}
      RETURNING *`) as Row[];
    return rows.length ? toJob(rows[0]) : null;
  }

  async stale(before: number, limit = 50) {
    await ensureTable(this.sql);
    const rows = (await this.sql`
      SELECT * FROM creative_jobs
      WHERE status NOT IN ('ready', 'failed', 'cancelled')
        AND updated_at < ${new Date(before).toISOString()}
      ORDER BY updated_at ASC
      LIMIT ${limit}`) as Row[];
    return rows.map(toJob);
  }

  async list(workspaceKey: string, limit = 50) {
    await ensureTable(this.sql);
    const rows = (await this.sql`
      SELECT * FROM creative_jobs WHERE workspace_key = ${workspaceKey}
      ORDER BY created_at DESC LIMIT ${limit}`) as Row[];
    return rows.map(toJob);
  }
}
