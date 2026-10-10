import { randomBytes } from "node:crypto";
import { db, RUNTIME_DDL, type Sql } from "@/lib/db";
import { pagePath, type AutopilotConfig } from "./autopilot";

// Where each workspace's autopilot lives. One row per workspace, its settings as JSON, and
// the install beacon's counters in their own columns so a busy site's page views don't
// rewrite the whole document on every hit.

export interface AutopilotStore {
  get(workspace: string): Promise<AutopilotConfig | null>;
  byKey(siteKey: string): Promise<AutopilotConfig | null>;
  /** Creates on first save. Changing the site keeps the key, so the pasted tag still works. */
  save(cfg: Omit<AutopilotConfig, "siteKey" | "seen"> & { siteKey?: string }): Promise<AutopilotConfig>;
  seen(siteKey: string, path: string, at: number): Promise<void>;
}

const newKey = () => randomBytes(9).toString("base64url");
const empty = { count: 0, lastAt: null, lastPath: null, paths: [] as string[] };
const MAX_SEEN_PATHS = 50;

export class InMemoryAutopilotStore implements AutopilotStore {
  private byWs = new Map<string, AutopilotConfig>();
  async get(ws: string) { return this.byWs.get(ws) ?? null; }
  async byKey(k: string) { return [...this.byWs.values()].find((c) => c.siteKey === k) ?? null; }
  async save(c: Omit<AutopilotConfig, "siteKey" | "seen"> & { siteKey?: string }) {
    const prev = this.byWs.get(c.workspace);
    const full: AutopilotConfig = { ...c, siteKey: prev?.siteKey ?? c.siteKey ?? newKey(), seen: prev?.seen ?? { ...empty } };
    this.byWs.set(c.workspace, full);
    return full;
  }
  async seen(k: string, path: string, at: number) {
    const c = await this.byKey(k);
    if (!c) return;
    const p = pagePath(path);
    c.seen = { count: c.seen.count + 1, lastAt: at, lastPath: p, paths: c.seen.paths.includes(p) ? c.seen.paths : [...c.seen.paths, p].slice(-MAX_SEEN_PATHS) };
  }
}

let ready = false;
async function ensure(sql: Sql) {
  if (ready || !RUNTIME_DDL) { ready = true; return; }
  await sql`CREATE TABLE IF NOT EXISTS seo_autopilot (
    workspace TEXT PRIMARY KEY, site_key TEXT NOT NULL UNIQUE, config JSONB NOT NULL,
    seen_count BIGINT NOT NULL DEFAULT 0, last_seen_at BIGINT, last_seen_path TEXT, seen_paths JSONB NOT NULL DEFAULT '[]')`;
  ready = true;
}

type Row = { workspace: string; site_key: string; config: Omit<AutopilotConfig, "siteKey" | "seen" | "workspace">; seen_count: string | number; last_seen_at: string | number | null; last_seen_path: string | null; seen_paths: string[] };
const toCfg = (r: Row): AutopilotConfig => ({
  ...r.config, workspace: r.workspace, siteKey: r.site_key,
  seen: { count: Number(r.seen_count), lastAt: r.last_seen_at === null ? null : Number(r.last_seen_at), lastPath: r.last_seen_path, paths: r.seen_paths ?? [] },
});

export class NeonAutopilotStore implements AutopilotStore {
  constructor(private sql: Sql) {}
  async get(ws: string) {
    await ensure(this.sql);
    const r = await this.sql`SELECT * FROM seo_autopilot WHERE workspace = ${ws}` as Row[];
    return r[0] ? toCfg(r[0]) : null;
  }
  async byKey(k: string) {
    await ensure(this.sql);
    const r = await this.sql`SELECT * FROM seo_autopilot WHERE site_key = ${k}` as Row[];
    return r[0] ? toCfg(r[0]) : null;
  }
  async save(c: Omit<AutopilotConfig, "siteKey" | "seen"> & { siteKey?: string }) {
    await ensure(this.sql);
    const { workspace, ...config } = c;
    delete (config as { siteKey?: string }).siteKey;
    const key = c.siteKey ?? newKey();
    await this.sql`INSERT INTO seo_autopilot (workspace, site_key, config) VALUES (${workspace}, ${key}, ${JSON.stringify(config)})
      ON CONFLICT (workspace) DO UPDATE SET config = EXCLUDED.config`;
    return (await this.get(workspace))!;
  }
  async seen(k: string, path: string, at: number) {
    await ensure(this.sql);
    const p = pagePath(path).slice(0, 200);
    // Paths are capped: the beacon is public, and a crawler hitting endless URLs must not
    // grow the row without bound.
    await this.sql`UPDATE seo_autopilot SET seen_count = seen_count + 1, last_seen_at = ${at}, last_seen_path = ${p},
      seen_paths = CASE WHEN seen_paths ? ${p} OR jsonb_array_length(seen_paths) >= ${MAX_SEEN_PATHS} THEN seen_paths ELSE seen_paths || to_jsonb(${p}::text) END
      WHERE site_key = ${k}`;
  }
}

let store: AutopilotStore | null = null;
export function autopilotStore(): AutopilotStore {
  if (!store) { const sql = db(); store = sql ? new NeonAutopilotStore(sql) : new InMemoryAutopilotStore(); }
  return store;
}
