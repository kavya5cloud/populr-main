import { describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";

// The refusal store against a real Postgres (PGlite, in memory).
//
// tests/refusals-migration.test.ts checks the ALTER statements are issued; it can't show
// Postgres accepts them, or that the store works on a table that predates them. This starts
// from the table exactly as the refusal ledger first shipped it (83a0923, before Task B added
// the instead_* columns) — the shape a production table created in that window has.

const h = vi.hoisted(() => ({ sql: null as unknown }));
vi.mock("@/lib/db", () => ({ RUNTIME_DDL: true, db: () => h.sql }));

// The store remembers, per process, that its schema step has run. Each test loads it fresh,
// the way a new server process would.
const load = async () => {
  vi.resetModules();
  return import("@/lib/refusals/store");
};

const PRE_TASK_B = `CREATE TABLE refusals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_key TEXT NOT NULL,
  proposed TEXT NOT NULL,
  channel TEXT NOT NULL,
  reason TEXT NOT NULL,
  explanation TEXT NOT NULL,
  instead_did TEXT,
  checkable_at TIMESTAMPTZ,
  verdict TEXT NOT NULL DEFAULT 'unknown',
  evidence TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
)`;

// Neon's sql`` tag sends the template as a parameterised query; this does the same for PGlite.
async function database(table: "pre-task-b" | "none") {
  const pg = new PGlite();
  h.sql = async (strings: TemplateStringsArray, ...values: unknown[]) =>
    (await pg.query(strings.reduce((text, part, i) => `${text}$${i}${part}`), values)).rows;
  if (table === "pre-task-b") {
    await pg.exec(PRE_TASK_B);
    await pg.exec(`INSERT INTO refusals (workspace_key, proposed, channel, reason, explanation)
      VALUES ('ws1', 'Post daily on LinkedIn', 'linkedin', 'wrong_audience', 'Your buyers are not on LinkedIn.')`);
  }
}

const refusal = {
  workspaceKey: "ws1",
  proposed: "Run Instagram reels",
  channel: "instagram",
  reason: "low_intent" as const,
  explanation: "Reels reach browsers, not buyers.",
  insteadDid: "Wrote two SEO pages",
  insteadChannel: "seo",
  checkableAt: Date.now() - 1000,
};

describe("refusal store on real Postgres", () => {
  it("works on a table created before Task B: records, lists and grades", async () => {
    await database("pre-task-b");
    const repo = (await load()).refusalRepo();

    const r = await repo.record(refusal);
    expect(r.insteadChannel).toBe("seo");
    expect(r.insteadOutcome).toBe("unknown");

    const list = await repo.list("ws1");
    expect(list).toHaveLength(2);
    // A row recorded before the columns existed has no channel to grade, and stays unknown.
    const old = list.find((x) => x.channel === "linkedin")!;
    expect(old.insteadChannel).toBeNull();
    expect(old.insteadOutcome).toBe("unknown");

    expect(await repo.dueWorkspaces(Date.now())).toContain("ws1");
    await repo.resolveInstead(r.id, "worked", "Organic signups up on the two pages", Date.now());
    expect((await repo.list("ws1")).find((x) => x.id === r.id)!.insteadOutcome).toBe("worked");
  });

  it("works on a brand-new database, and the schema step is safe to run again", async () => {
    await database("none");
    const r = await (await load()).refusalRepo().record(refusal);
    expect(r.insteadChannel).toBe("seo");
    // A second process runs the schema step against the table that now exists.
    expect(await (await load()).refusalRepo().list("ws1")).toHaveLength(1);
  });
});