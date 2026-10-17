import { createHash } from "node:crypto";
import { db, RUNTIME_DDL, type Sql } from "@/lib/db";
import type { JsonRpcRequest, JsonRpcResponse } from "@/lib/mcp/server";

// How developers use Populr's MCP server — counted, not logged.
//
// One row per day × workspace × method × tool × outcome × client, holding a count. Nothing
// else: no keys, no tool arguments, no URLs, no results. The workspace is stored as a salted
// one-way hash, enough to count distinct workspaces and follow one through the funnel, not to
// say whose it is. The outcome is the tool's structured status ("live", "missing_changes",
// "not_set_up"…), a closed set, so "fixes verified live" is countable without reading content.

export type UsageEvent = {
  /** The key's workspace, or null for a keyless call (directories listing the tools). */
  workspace: string | null;
  method: string;
  tool?: string;
  outcome: string;
  /** The client's name from initialize (e.g. "Visual Studio Code"), when it sent one. */
  client?: string;
};

export type UsageRow = { day: string; ws: string; method: string; tool: string; outcome: string; client: string; calls: number };

export const KEYLESS = "-";

export function workspaceHash(workspace: string | null): string {
  if (!workspace) return KEYLESS;
  return createHash("sha256").update(`populr-mcp-usage:${workspace}`).digest("hex").slice(0, 16);
}

// The client's self-reported name is untrusted input: keep it short and plain.
export function clientName(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/[^\w .()/-]/g, "").trim().slice(0, 40) : "";
}

const day = (at: number) => new Date(at).toISOString().slice(0, 10);
const keyOf = (r: Omit<UsageRow, "calls">) => [r.day, r.ws, r.method, r.tool, r.outcome, r.client].join("\u0000");

function toRow(e: UsageEvent, at: number): Omit<UsageRow, "calls"> {
  return { day: day(at), ws: workspaceHash(e.workspace), method: e.method.slice(0, 40), tool: (e.tool ?? "").slice(0, 40), outcome: e.outcome.slice(0, 40), client: clientName(e.client) };
}

export interface UsageStore {
  record(e: UsageEvent, at: number): Promise<void>;
  rows(sinceDay: string): Promise<UsageRow[]>;
}

export class InMemoryUsageStore implements UsageStore {
  private counts = new Map<string, UsageRow>();
  async record(e: UsageEvent, at: number) {
    const r = toRow(e, at);
    const k = keyOf(r);
    const prev = this.counts.get(k);
    this.counts.set(k, { ...r, calls: (prev?.calls ?? 0) + 1 });
  }
  async rows(sinceDay: string) {
    return [...this.counts.values()].filter((r) => r.day >= sinceDay);
  }
}

let ready = false;
async function ensure(sql: Sql) {
  if (ready || !RUNTIME_DDL) { ready = true; return; }
  await sql`CREATE TABLE IF NOT EXISTS mcp_usage_daily (
    day DATE NOT NULL,
    ws TEXT NOT NULL,
    method TEXT NOT NULL,
    tool TEXT NOT NULL DEFAULT '',
    outcome TEXT NOT NULL,
    client TEXT NOT NULL DEFAULT '',
    calls INT NOT NULL DEFAULT 0,
    PRIMARY KEY (day, ws, method, tool, outcome, client)
  )`;
  ready = true;
}

export class NeonUsageStore implements UsageStore {
  constructor(private sql: Sql) {}
  async record(e: UsageEvent, at: number) {
    await ensure(this.sql);
    const r = toRow(e, at);
    await this.sql`
      INSERT INTO mcp_usage_daily (day, ws, method, tool, outcome, client, calls)
      VALUES (${r.day}, ${r.ws}, ${r.method}, ${r.tool}, ${r.outcome}, ${r.client}, 1)
      ON CONFLICT (day, ws, method, tool, outcome, client) DO UPDATE SET calls = mcp_usage_daily.calls + 1`;
  }
  async rows(sinceDay: string) {
    await ensure(this.sql);
    const rows = (await this.sql`
      SELECT to_char(day, 'YYYY-MM-DD') AS day, ws, method, tool, outcome, client, calls
      FROM mcp_usage_daily WHERE day >= ${sinceDay}::date`) as (Omit<UsageRow, "calls"> & { calls: number | string })[];
    return rows.map((r) => ({ ...r, calls: Number(r.calls) }));
  }
}

let store: UsageStore | null = null;
export function usageStore(): UsageStore {
  if (!store) { const sql = db(); store = sql ? new NeonUsageStore(sql) : new InMemoryUsageStore(); }
  return store;
}

// What gets counted: the method, the tool, a closed-set outcome (the tool's structured
// status), and the client's name from initialize. Never arguments, URLs or results.
export function usageEvent(msg: JsonRpcRequest, res: JsonRpcResponse, workspace: string | null): UsageEvent {
  const failed = "error" in res;
  const result = (failed ? null : res.result) as { isError?: boolean; structuredContent?: { status?: unknown } } | null;
  const outcome = failed ? "rpc_error"
    : msg.method !== "tools/call" ? "ok"
    : result?.isError ? "tool_error"
    : typeof result?.structuredContent?.status === "string" ? result.structuredContent.status
    : "ok";
  return {
    workspace,
    method: msg.method,
    tool: msg.method === "tools/call" ? String(msg.params?.name ?? "") : undefined,
    outcome,
    client: msg.method === "initialize" ? ((msg.params?.clientInfo as { name?: unknown } | undefined)?.name as string | undefined) : undefined,
  };
}

// ── The summary the admin page shows ─────────────────────────────────────────────────────

export type UsageSummary = {
  sinceDay: string;
  funnel: { workspacesConnected: number; workspacesCalledATool: number; workspacesFetchedFixes: number; workspacesVerifiedLive: number };
  daily: { day: string; workspaces: number; toolCalls: number; toolErrors: number; keylessCalls: number }[];
  tools: { tool: string; calls: number; workspaces: number; outcomes: Record<string, number> }[];
  clients: { client: string; workspaces: number }[];
};

const ERRORS = new Set(["rpc_error", "tool_error"]);

export function summarize(rows: UsageRow[], sinceDay: string): UsageSummary {
  const keyed = rows.filter((r) => r.ws !== KEYLESS);
  const wsWhere = (pred: (r: UsageRow) => boolean) => new Set(keyed.filter(pred).map((r) => r.ws)).size;
  const calls = (r: UsageRow) => r.method === "tools/call";

  const days = [...new Set(rows.map((r) => r.day))].sort();
  const daily = days.map((d) => {
    const today = rows.filter((r) => r.day === d);
    return {
      day: d,
      workspaces: new Set(today.filter((r) => r.ws !== KEYLESS).map((r) => r.ws)).size,
      toolCalls: today.filter((r) => calls(r) && r.ws !== KEYLESS).reduce((n, r) => n + r.calls, 0),
      toolErrors: today.filter((r) => calls(r) && ERRORS.has(r.outcome)).reduce((n, r) => n + r.calls, 0),
      keylessCalls: today.filter((r) => r.ws === KEYLESS).reduce((n, r) => n + r.calls, 0),
    };
  });

  const toolNames = [...new Set(keyed.filter(calls).map((r) => r.tool))].sort();
  const tools = toolNames.map((tool) => {
    const these = keyed.filter((r) => calls(r) && r.tool === tool);
    const outcomes: Record<string, number> = {};
    for (const r of these) outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + r.calls;
    return { tool, calls: these.reduce((n, r) => n + r.calls, 0), workspaces: new Set(these.map((r) => r.ws)).size, outcomes };
  }).sort((a, b) => b.calls - a.calls);

  const clientNames = [...new Set(keyed.filter((r) => r.client).map((r) => r.client))];
  const clients = clientNames.map((client) => ({ client, workspaces: wsWhere((r) => r.client === client) })).sort((a, b) => b.workspaces - a.workspaces);

  return {
    sinceDay,
    funnel: {
      workspacesConnected: wsWhere(() => true),
      workspacesCalledATool: wsWhere(calls),
      workspacesFetchedFixes: wsWhere((r) => calls(r) && r.tool === "get_seo_fixes" && r.outcome === "ok"),
      workspacesVerifiedLive: wsWhere((r) => calls(r) && r.tool === "verify_page" && r.outcome === "live"),
    },
    daily,
    tools,
    clients,
  };
}
