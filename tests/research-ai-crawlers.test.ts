import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readable, STUDY, studyCsv, studyStats } from "@/lib/research/ai-crawlers-india";
import { CRAWLERS } from "@/lib/tools/robots";

// The study page computes its figures from the data, but a few statements are words — which
// site blocks what. These tests hold the words to the data: re-run the study, and if a
// statement stops being true, this fails before the page can say something false.

const s = studyStats();
const site = (d: string) => STUDY.sites.find((x) => x.domain === d)!;

describe("the dataset", () => {
  it("is the top 500 .in domains, in rank order, each once", () => {
    expect(STUDY.sites).toHaveLength(500);
    expect(STUDY.sites.every((x) => x.domain.endsWith(".in"))).toBe(true);
    expect(new Set(STUDY.sites.map((x) => x.domain)).size).toBe(500);
    expect(STUDY.sites.every((x, i, a) => i === 0 || a[i - 1].rank < x.rank)).toBe(true);
  });

  it("was checked against the same crawlers the checker knows", () => {
    expect(STUDY.crawlers.map((c) => c.agent)).toEqual(CRAWLERS.map((c) => c.agent));
  });

  it("only records blocks for sites whose robots.txt was read", () => {
    for (const x of STUDY.sites) if (x.robots !== "found") expect(x.blocked).toEqual([]);
  });

  it("explains every site it couldn't read", () => {
    for (const x of STUDY.sites.filter((y) => !readable(y))) expect(x.note).toBeTruthy();
    expect(s.readable + s.unread).toBe(s.total);
    expect(s.unreadReasons.reduce((n, [, c]) => n + c, 0)).toBe(s.unread);
  });
});

describe("what the page says in words", () => {
  it("amazon.in keeps out ChatGPT search, Claude and Perplexity", () => {
    for (const a of ["OAI-SearchBot", "Claude-SearchBot", "PerplexityBot"]) expect(site("amazon.in").blocked).toContain(a);
    expect(s.blockAnyAnswers.map((x) => x.domain)).toContain("amazon.in");
  });

  it("three national government sites and one state site keep out every crawler, Google included", () => {
    for (const d of ["nha.gov.in", "ncrb.gov.in", "ireps.gov.in", "samsodisha.gov.in"]) {
      expect(site(d).group).toBe("government");
      expect(site(d).blocked).toContain("Googlebot");
      expect(site(d).blockAll).toBe(true);
    }
  });

  it("almost all of AI search is open, and training is blocked more often than search", () => {
    expect(s.blockAnyAnswers.length / s.readable).toBeLessThan(0.1);
    expect(s.blockAnyTraining.length).toBeGreaterThan(s.blockAnyAnswers.length);
    expect(s.trainingOnly.length).toBeGreaterThan(0);
  });

  it("names only real figures from the data in its words", () => {
    const page = readFileSync(path.join(__dirname, "..", "app/research/ai-crawlers-india/page.tsx"), "utf8");
    // Figures come from studyStats; a hard-coded percentage or count in the copy would drift.
    expect(page).not.toMatch(/\b\d{1,3}(\.\d)?%/);
  });
});

describe("the download", () => {
  it("has a header and one row per site", () => {
    const rows = studyCsv().trim().split("\n");
    expect(rows[0]).toBe("rank,domain,group,robots_txt,blocked_crawlers,blocks_unknown_crawlers,names_ai_crawlers,has_llms_txt,note");
    expect(rows).toHaveLength(501);
    expect(rows.find((r) => r.includes(",amazon.in,"))).toMatch(/OAI-SearchBot/);
  });
});

describe("telling AI-specific blocks from blanket ones", () => {
  it("separates sites that single out AI from sites that block every crawler", () => {
    expect(s.singleOutAi.map((x) => x.domain)).toContain("amazon.in");
    expect(s.singleOutAi.some((x) => x.blocked.includes("Googlebot"))).toBe(false);
    expect(s.singleOutAi.length + s.blockAnyAnswers.filter((x) => x.blocked.includes("Googlebot")).length).toBe(s.blockAnyAnswers.length);
  });
});
