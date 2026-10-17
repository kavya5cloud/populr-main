import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

// The schema, on a real Postgres (PGlite, in memory).
//
// Two things build the database: db/migrations/*.sql (npm run db:migrate), and the ensure()
// steps in lib/ that run CREATE/ALTER at request time. They drifted: 20 tables existed only
// in code, and a column added to a CREATE TABLE never reached tables made before it (the
// refusals bug). Mocks can't catch either — only running the statements can. So:
//
//   A  migrations alone
//   B  A, then every schema statement in the code     → must change nothing
//   C  every schema statement in the code, fresh      → everything it makes must be in A
//
// and no schema statement may interpolate ${…}: sql`` sends those as parameters, which
// Postgres refuses in CREATE/ALTER.

const root = path.resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}

const DDL = /^\s*(CREATE (UNIQUE )?(TABLE|INDEX)|ALTER TABLE)\b/i;
const codeDdl = ["lib", "app"].flatMap((d) => sourceFiles(path.join(root, d))).flatMap((file) =>
  [...readFileSync(file, "utf8").matchAll(/sql`([\s\S]*?)`/g)]
    .map((m) => m[1])
    .filter((s) => DDL.test(s))
    .map((sql) => ({ file: path.relative(root, file), sql })),
);

// The same split scripts/migrate.mjs does.
const migrationStatements = readdirSync(path.join(root, "db/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .flatMap((f) => readFileSync(path.join(root, "db/migrations", f), "utf8").replace(/^\s*--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean));

async function snapshot(pg: PGlite) {
  const cols = await pg.query<{ t: string; c: string; type: string; nullable: string; def: string | null }>(
    `SELECT table_name t, column_name c, data_type type, is_nullable nullable, column_default def
       FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1, 2`);
  const idx = await pg.query<{ name: string; def: string }>(`SELECT indexname name, indexdef def FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1`);
  return { columns: cols.rows, indexes: idx.rows };
}

// Statements in any order: retry the ones that fail (a foreign key to a table another file
// creates) until nothing more succeeds.
async function runAll(pg: PGlite, stmts: string[]) {
  let pending = stmts, errors: string[] = [];
  for (;;) {
    const next: string[] = [];
    errors = [];
    for (const s of pending) {
      try { await pg.exec(s); } catch (e) { next.push(s); errors.push(`${(e as Error).message} — ${s.replace(/\s+/g, " ").slice(0, 90)}`); }
    }
    if (!next.length || next.length === pending.length) return errors;
    pending = next;
  }
}

describe("schema: migrations and code agree, on real Postgres", () => {
  it("no schema statement interpolates a value (Postgres rejects parameters in DDL)", () => {
    const bad = codeDdl.filter((d) => d.sql.includes("${")).map((d) => `${d.file}: ${d.sql.replace(/\s+/g, " ").slice(0, 80)}`);
    expect(bad).toEqual([]);
  });

  it("migrations build the whole schema the code expects", async () => {
    const a = new PGlite();
    expect(await runAll(a, migrationStatements)).toEqual([]);
    const fromMigrations = await snapshot(a);

    // B: the code's statements on top must be no-ops.
    expect(await runAll(a, codeDdl.map((d) => d.sql))).toEqual([]);
    const after = await snapshot(a);
    const key = (c: { t: string; c: string }) => `${c.t}.${c.c}`;
    const known = new Set(fromMigrations.columns.map(key));
    expect(after.columns.map(key).filter((k) => !known.has(k)), "columns only the code creates — add them to a migration").toEqual([]);
    const knownIdx = new Set(fromMigrations.indexes.map((i) => i.name));
    expect(after.indexes.map((i) => i.name).filter((n) => !knownIdx.has(n)), "indexes only the code creates — add them to a migration").toEqual([]);

    // C: a fresh database built by the code alone has nothing migrations lack, with the
    // same column types (catches a column added to a CREATE TABLE body but never migrated).
    const c = new PGlite();
    expect(await runAll(c, codeDdl.map((d) => d.sql))).toEqual([]);
    const fromCode = await snapshot(c);
    const migType = new Map(fromMigrations.columns.map((col) => [key(col), col.type]));
    const mismatched = fromCode.columns.filter((col) => migType.get(key(col)) !== col.type).map((col) => `${key(col)} (${col.type} in code, ${migType.get(key(col)) ?? "missing"} in migrations)`);
    expect(mismatched, "columns that differ between code and migrations").toEqual([]);
  });
});
