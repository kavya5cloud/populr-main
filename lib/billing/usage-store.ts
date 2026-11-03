import { db, ensureSchema, RUNTIME_DDL, type Sql } from "@/lib/db";

// How many AI actions an account or a visitor has used in a period.
//
// `add` is one atomic statement, so requests arriving together cannot all read the same count
// and all get past the limit. Subjects are "user:<id>", or a hash for visitors: a network
// address is never stored as it arrived.

export interface UsageRepo {
  /** Adds to the count and returns the new total. */
  add(subject: string, period: string, n: number): Promise<number>;
  get(subject: string, period: string): Promise<number>;
  /** Forgets periods older than this, so hashed addresses are not kept for long. */
  prune(before: number): Promise<void>;
}

export class InMemoryUsageRepo implements UsageRepo {
  private rows = new Map<string, { used: number; at: number }>();

  async add(subject: string, period: string, n: number) {
    const key = `${subject}|${period}`;
    const used = (this.rows.get(key)?.used ?? 0) + n;
    this.rows.set(key, { used, at: Date.now() });
    return used;
  }
  async get(subject: string, period: string) {
    return this.rows.get(`${subject}|${period}`)?.used ?? 0;
  }
  async prune(before: number) {
    for (const [k, v] of this.rows) if (v.at < before) this.rows.delete(k);
  }
}

async function ensureTable(sql: Sql) {
  if (!RUNTIME_DDL) return;
  await sql`
    CREATE TABLE IF NOT EXISTS ai_usage (
      subject TEXT NOT NULL,
      period TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (subject, period)
    )`;
}

export class NeonUsageRepo implements UsageRepo {
  constructor(private sql: Sql) {}

  private async ready() {
    await ensureSchema(this.sql);
    await ensureTable(this.sql);
  }

  async add(subject: string, period: string, n: number) {
    await this.ready();
    const rows = (await this.sql`
      INSERT INTO ai_usage (subject, period, used, updated_at)
      VALUES (${subject}, ${period}, ${n}, ${Date.now()})
      ON CONFLICT (subject, period) DO UPDATE SET
        used = ai_usage.used + EXCLUDED.used,
        updated_at = EXCLUDED.updated_at
      RETURNING used`) as { used: number }[];
    return Number(rows[0]?.used ?? n);
  }

  async get(subject: string, period: string) {
    await this.ready();
    const rows = (await this.sql`SELECT used FROM ai_usage WHERE subject = ${subject} AND period = ${period}`) as { used: number }[];
    return Number(rows[0]?.used ?? 0);
  }

  async prune(before: number) {
    await this.ready();
    await this.sql`DELETE FROM ai_usage WHERE updated_at < ${before}`;
  }
}

let memo: UsageRepo | null = null;

export function usageRepo(): UsageRepo {
  if (memo) return memo;
  const sql = db();
  memo = sql ? new NeonUsageRepo(sql) : new InMemoryUsageRepo();
  return memo;
}
