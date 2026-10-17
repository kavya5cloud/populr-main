import { db, RUNTIME_DDL, type Sql } from "@/lib/db";
import type { CheckResult } from "./checks";

// The latest check for each domain, so a shared link shows the same result to everyone and
// a popular link doesn't refetch the site on every view.

export interface CheckStore {
  get(domain: string): Promise<CheckResult | null>;
  save(result: CheckResult): Promise<void>;
}

export class InMemoryCheckStore implements CheckStore {
  private rows = new Map<string, CheckResult>();
  async get(domain: string) { return this.rows.get(domain) ?? null; }
  async save(r: CheckResult) { this.rows.set(r.domain, r); }
}

let ready = false;
async function ensure(sql: Sql) {
  if (ready || !RUNTIME_DDL) { ready = true; return; }
  await sql`CREATE TABLE IF NOT EXISTS site_checks (
    domain TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    score INT NOT NULL,
    result JSONB NOT NULL,
    checked_at BIGINT NOT NULL,
    times_checked INT NOT NULL DEFAULT 1
  )`;
  ready = true;
}

export class NeonCheckStore implements CheckStore {
  constructor(private sql: Sql) {}
  async get(domain: string) {
    await ensure(this.sql);
    const rows = (await this.sql`SELECT result FROM site_checks WHERE domain = ${domain}`) as { result: CheckResult }[];
    return rows[0]?.result ?? null;
  }
  async save(r: CheckResult) {
    await ensure(this.sql);
    await this.sql`
      INSERT INTO site_checks (domain, url, score, result, checked_at)
      VALUES (${r.domain}, ${r.url}, ${r.score}, ${JSON.stringify(r)}::jsonb, ${r.checkedAt})
      ON CONFLICT (domain) DO UPDATE SET url = EXCLUDED.url, score = EXCLUDED.score, result = EXCLUDED.result,
        checked_at = EXCLUDED.checked_at, times_checked = site_checks.times_checked + 1`;
  }
}

// Kept on globalThis: without a database, the dev server gives the API route and the result
// page separate copies of this module, and a result saved by one has to be visible to the other.
const g = globalThis as unknown as { __populrCheckStore?: CheckStore };
export function checkStore(): CheckStore {
  if (!g.__populrCheckStore) { const sql = db(); g.__populrCheckStore = sql ? new NeonCheckStore(sql) : new InMemoryCheckStore(); }
  return g.__populrCheckStore;
}
