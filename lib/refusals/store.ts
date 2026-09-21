import { randomUUID } from "node:crypto";
import { db, RUNTIME_DDL, type Sql } from "@/lib/db";
import type { NewRefusal, Refusal, Verdict, InsteadOutcome } from "./types";

// Where refusals live.
//
// Same shape as every other store here: one interface, an in-memory implementation that the
// tests and an unconfigured environment use, and a Neon one for production. Callers ask
// refusalRepo() and never learn which they got.

export interface RefusalRepo {
  record(r: NewRefusal): Promise<Refusal>;
  list(workspaceKey: string, limit?: number): Promise<Refusal[]>;
  /** Refusals whose checkable date has passed and which have no verdict yet. */
  due(workspaceKey: string, now: number): Promise<Refusal[]>;
  /**
   * Workspace keys with at least one unresolved, now-checkable refusal — nothing else.
   * Deliberately returns only keys, never refusal content: every other method on this
   * interface is workspace-scoped, and a method that returned rows across every workspace
   * would eventually get called somewhere unscoped. This is how a cron discovers which
   * workspaces to call due() on, without that risk existing.
   */
  dueWorkspaces(now: number, limit?: number): Promise<string[]>;
  resolve(id: string, verdict: Verdict, evidence: string, at: number): Promise<void>;
  /**
   * Write insteadOutcome once, independent of verdict. Same write-once discipline as
   * resolve(): only writes from "unknown", so weaker channel-level evidence can never
   * overwrite itself and can never touch verdict.
   */
  resolveInstead(id: string, outcome: InsteadOutcome, evidence: string, at: number): Promise<void>;
}

class InMemoryRefusalRepo implements RefusalRepo {
  private rows: Refusal[] = [];

  async record(r: NewRefusal): Promise<Refusal> {
    const row: Refusal = {
      ...r,
      id: randomUUID(),
      verdict: "unknown",
      evidence: null,
      createdAt: Date.now(),
      resolvedAt: null,
      insteadOutcome: "unknown",
      insteadEvidence: null,
      insteadResolvedAt: null,
    };
    this.rows.unshift(row);
    return row;
  }
  async list(workspaceKey: string, limit = 100): Promise<Refusal[]> {
    return this.rows.filter((r) => r.workspaceKey === workspaceKey).slice(0, limit);
  }
  async due(workspaceKey: string, now: number): Promise<Refusal[]> {
    return this.rows.filter(
      (r) => r.workspaceKey === workspaceKey && r.verdict === "unknown" && r.checkableAt != null && r.checkableAt <= now,
    );
  }
  async dueWorkspaces(now: number, limit = 200): Promise<string[]> {
    const keys = new Set<string>();
    for (const r of this.rows) {
      if (r.verdict === "unknown" && r.checkableAt != null && r.checkableAt <= now) keys.add(r.workspaceKey);
      if (keys.size >= limit) break;
    }
    return [...keys];
  }
  async resolve(id: string, verdict: Verdict, evidence: string, at: number): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) { row.verdict = verdict; row.evidence = evidence; row.resolvedAt = at; }
  }
  async resolveInstead(id: string, outcome: InsteadOutcome, evidence: string, at: number): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row && row.insteadOutcome === "unknown") {
      row.insteadOutcome = outcome;
      row.insteadEvidence = evidence;
      row.insteadResolvedAt = at;
    }
  }
}

let ready = false;
async function ensure(sql: Sql) {
  if (ready || !RUNTIME_DDL) { ready = true; return; }
  await sql`CREATE TABLE IF NOT EXISTS refusals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_key TEXT NOT NULL,
    proposed TEXT NOT NULL,
    channel TEXT NOT NULL,
    reason TEXT NOT NULL,
    explanation TEXT NOT NULL,
    instead_did TEXT,
    instead_channel TEXT,
    checkable_at TIMESTAMPTZ,
    verdict TEXT NOT NULL DEFAULT 'unknown',
    evidence TEXT,
    instead_outcome TEXT NOT NULL DEFAULT 'unknown',
    instead_evidence TEXT,
    instead_resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_refusals_ws ON refusals (workspace_key, created_at DESC)`;
  // The grading pass asks for exactly this: unresolved, and now checkable. Without the index
  // it is a full scan on a table that only ever grows.
  await sql`CREATE INDEX IF NOT EXISTS idx_refusals_due ON refusals (workspace_key, verdict, checkable_at)`;
  // Workspace discovery (dueWorkspaces) has no workspace_key in its WHERE clause — it's
  // asking "which workspaces", not "what's due in this one" — so the index above, which
  // leads with workspace_key, is the wrong column order for that query. This one matches it.
  await sql`CREATE INDEX IF NOT EXISTS idx_refusals_due_any_ws ON refusals (verdict, checkable_at)`;
  ready = true;
}

type Row = {
  id: string; workspace_key: string; proposed: string; channel: string; reason: string;
  explanation: string; instead_did: string | null; instead_channel: string | null;
  checkable_at: string | null;
  verdict: string; evidence: string | null;
  instead_outcome: string; instead_evidence: string | null; instead_resolved_at: string | null;
  created_at: string; resolved_at: string | null;
};

const toRefusal = (r: Row): Refusal => ({
  id: r.id,
  workspaceKey: r.workspace_key,
  proposed: r.proposed,
  channel: r.channel,
  reason: r.reason as Refusal["reason"],
  explanation: r.explanation,
  insteadDid: r.instead_did,
  insteadChannel: r.instead_channel,
  checkableAt: r.checkable_at ? new Date(r.checkable_at).getTime() : null,
  verdict: r.verdict as Verdict,
  evidence: r.evidence,
  insteadOutcome: r.instead_outcome as InsteadOutcome,
  insteadEvidence: r.instead_evidence,
  insteadResolvedAt: r.instead_resolved_at ? new Date(r.instead_resolved_at).getTime() : null,
  createdAt: new Date(r.created_at).getTime(),
  resolvedAt: r.resolved_at ? new Date(r.resolved_at).getTime() : null,
});

class NeonRefusalRepo implements RefusalRepo {
  constructor(private sql: Sql) {}

  async record(r: NewRefusal): Promise<Refusal> {
    await ensure(this.sql);
    const rows = (await this.sql`
      INSERT INTO refusals (workspace_key, proposed, channel, reason, explanation, instead_did, instead_channel, checkable_at)
      VALUES (${r.workspaceKey}, ${r.proposed}, ${r.channel}, ${r.reason}, ${r.explanation}, ${r.insteadDid}, ${r.insteadChannel},
              ${r.checkableAt ? new Date(r.checkableAt).toISOString() : null})
      RETURNING *`) as Row[];
    return toRefusal(rows[0]);
  }

  async list(workspaceKey: string, limit = 100): Promise<Refusal[]> {
    await ensure(this.sql);
    const rows = (await this.sql`
      SELECT * FROM refusals WHERE workspace_key = ${workspaceKey}
      ORDER BY created_at DESC LIMIT ${limit}`) as Row[];
    return rows.map(toRefusal);
  }

  async due(workspaceKey: string, now: number): Promise<Refusal[]> {
    await ensure(this.sql);
    const rows = (await this.sql`
      SELECT * FROM refusals
      WHERE workspace_key = ${workspaceKey} AND verdict = 'unknown'
        AND checkable_at IS NOT NULL AND checkable_at <= ${new Date(now).toISOString()}
      ORDER BY checkable_at ASC LIMIT 200`) as Row[];
    return rows.map(toRefusal);
  }

  async dueWorkspaces(now: number, limit = 200): Promise<string[]> {
    await ensure(this.sql);
    const rows = (await this.sql`
      SELECT DISTINCT workspace_key FROM refusals
      WHERE verdict = 'unknown' AND checkable_at IS NOT NULL AND checkable_at <= ${new Date(now).toISOString()}
      ORDER BY workspace_key LIMIT ${limit}`) as { workspace_key: string }[];
    return rows.map((r) => r.workspace_key);
  }

  async resolve(id: string, verdict: Verdict, evidence: string, at: number): Promise<void> {
    await ensure(this.sql);
    // Only from unknown. A verdict is written once — re-grading a resolved refusal is how a
    // ledger quietly improves its own record over time, which is the failure this exists to
    // avoid being accused of.
    await this.sql`
      UPDATE refusals SET verdict = ${verdict}, evidence = ${evidence}, resolved_at = ${new Date(at).toISOString()}
      WHERE id = ${id} AND verdict = 'unknown'`;
  }

  async resolveInstead(id: string, outcome: InsteadOutcome, evidence: string, at: number): Promise<void> {
    await ensure(this.sql);
    // Same write-once discipline as resolve(), on its own column — this can never touch
    // verdict, and verdict can never touch this.
    await this.sql`
      UPDATE refusals SET instead_outcome = ${outcome}, instead_evidence = ${evidence}, instead_resolved_at = ${new Date(at).toISOString()}
      WHERE id = ${id} AND instead_outcome = 'unknown'`;
  }
}

let memo: RefusalRepo | null = null;
export function refusalRepo(): RefusalRepo {
  if (memo) return memo;
  const sql = db();
  memo = sql ? new NeonRefusalRepo(sql) : new InMemoryRefusalRepo();
  return memo;
}

/** Tests need a fresh repo per case; nothing else should call this. */
export function resetRefusalRepoForTests(): void {
  memo = null;
}
