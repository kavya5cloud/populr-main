import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { EMITTED_REFUSAL_REASONS, REFUSAL_REASONS } from "@/lib/refusals/types";

// The landing page tells visitors how many reasons Populr gives for declining work. It said
// six while the product only ever gave four. This finds which reasons the code actually
// produces, so the published number follows the product rather than the vocabulary.

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? sources(p) : /\.(ts|tsx)$/.test(e) ? [p] : [];
  });
}

describe("the reasons Populr says it gives are the ones it gives", () => {
  it("matches the reasons the code produces", () => {
    const code = [...sources(join(process.cwd(), "lib")), ...sources(join(process.cwd(), "app"))]
      .filter((f) => !f.endsWith(join("refusals", "types.ts")))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    const produced = REFUSAL_REASONS.filter((r) => code.includes(`"${r}"`));
    // Every listed reason is produced somewhere, and every produced one is listed.
    for (const r of EMITTED_REFUSAL_REASONS) expect(code.includes(`"${r}"`), `${r} is listed but nothing produces it`).toBe(true);
    for (const r of produced) expect(EMITTED_REFUSAL_REASONS, `${r} is produced but not counted`).toContain(r);
  });

  it("is a subset of the ledger's vocabulary", () => {
    for (const r of EMITTED_REFUSAL_REASONS) expect(REFUSAL_REASONS).toContain(r);
  });
});
