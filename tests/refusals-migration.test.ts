import { describe, it, expect, vi } from "vitest";

const statements = vi.hoisted(() => [] as string[]);

vi.mock("@/lib/db", () => ({
  RUNTIME_DDL: true,
  db: () => (strings: TemplateStringsArray) => {
    statements.push(strings.join("?"));
    return Promise.resolve([]);
  },
}));

import { refusalRepo, resetRefusalRepoForTests } from "@/lib/refusals/store";

describe("refusals schema", () => {
  // CREATE TABLE IF NOT EXISTS does nothing for a table that already exists, so columns added
  // later only reach it through ALTER TABLE. This pins that the statements are issued; it
  // cannot show Postgres accepts them, which needs a real database.
  it("adds the instead_* columns to a table that already exists", async () => {
    resetRefusalRepoForTests();
    await refusalRepo().list("ws1");
    const ddl = statements.join("\n");
    for (const col of ["instead_channel", "instead_outcome", "instead_evidence", "instead_resolved_at"]) {
      expect(ddl).toMatch(new RegExp(`ALTER TABLE refusals ADD COLUMN IF NOT EXISTS ${col}\\b`));
    }
  });
});
