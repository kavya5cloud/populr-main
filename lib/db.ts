import { neon } from "@neondatabase/serverless";

export function db() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return neon(url);
}

export type Sql = NonNullable<ReturnType<typeof db>>;

// Two things can build the schema, and each must be able to do it alone:
//   - db/migrations/*.sql, applied with npm run db:migrate;
//   - the ensure* steps, which run idempotent CREATE/ALTER on first use in each process,
//     unless SKIP_RUNTIME_DDL=true.
// Production has relied on the ensure* steps: tables that existed only in code (api_keys,
// seo_autopilot) work there. The two once drifted apart — 20 tables existed only in code —
// so tests/schema-migrations.test.ts now builds both on a real Postgres and fails if the
// code creates anything migrations don't. Only set SKIP_RUNTIME_DDL=true after running
// every migration against the database.
// Schema statements can't interpolate values: sql`` sends ${…} as a parameter, and Postgres
// refuses parameters in CREATE/ALTER.
export const RUNTIME_DDL = process.env.SKIP_RUNTIME_DDL !== "true";

let schemaReady = false;
export async function ensureSchema(sql: Sql) {
  if (schemaReady) return;
  if (!RUNTIME_DDL) { schemaReady = true; return; }
  await sql`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS workspaces (
    wsid TEXT PRIMARY KEY,
    state JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  // Referrals. referred_user_id is the primary key, not a plain column: one account can be
  // credited to exactly one referrer, exactly once, enforced by the database rather than by
  // remembering to check. A replayed signup cannot mint a second month.
  await sql`CREATE TABLE IF NOT EXISTS referrals (
    referred_user_id TEXT PRIMARY KEY,
    referrer_id TEXT NOT NULL,
    code TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A signup alone is not worth a free month: without email verification anyone can make
    -- one in seconds. The row is written at signup so the link is not lost, but it only
    -- counts towards a reward once the account does something real.
    qualified_at TIMESTAMPTZ
  )`;
  await sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS qualified_at TIMESTAMPTZ`;
  await sql`CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON referrals (referrer_id)`;
  schemaReady = true;
}
