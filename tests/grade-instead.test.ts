import { describe, it, expect } from "vitest";
import { gradeInsteadOutcome, isGradableInsteadChannel, GRADABLE_INSTEAD_CHANNELS } from "@/lib/refusals/grade-instead";
import { associationScore, type MetricDelta } from "@/lib/intel-score";

// Pins the reasoning behind the 0.6 threshold: associationScore() is built so 0.5 is
// exactly "no movement" (each of four weighted terms, summing to 1.0 weight, clipped to
// [-1, 1], added as half their sum to 0.5). This proves 0.6 requires a real, substantial
// move — not an arbitrary round number — by constructing the delta that produces it.
describe("the 0.6 band means real movement, not noise", () => {
  it("a delta with no change anywhere scores exactly 0.5 — true neutral", () => {
    const noMove: MetricDelta = {
      impressions: { before: 100, after: 100, pct: 0 },
      clicks: { before: 10, after: 10, pct: 0 },
      ctr: { before: 0.1, after: 0.1, pct: 0 },
      position: { before: 10, after: 10, change: 0 },
    };
    expect(associationScore(noMove)).toBe(0.5);
  });

  it("roughly a 45% clicks lift alone is enough to cross 0.6", () => {
    const clicksUp: MetricDelta = {
      impressions: { before: 100, after: 100, pct: 0 },
      clicks: { before: 100, after: 145, pct: 0.45 },
      ctr: { before: 0.1, after: 0.1, pct: 0 },
      position: { before: 10, after: 10, change: 0 },
    };
    expect(associationScore(clicksUp)).toBeGreaterThanOrEqual(0.6);
  });

  it("a move that doesn't reach the band stays below 0.6", () => {
    const smallMove: MetricDelta = {
      impressions: { before: 100, after: 105, pct: 0.05 },
      clicks: { before: 100, after: 105, pct: 0.05 },
      ctr: { before: 0.1, after: 0.1, pct: 0 },
      position: { before: 10, after: 10, change: 0 },
    };
    expect(associationScore(smallMove)).toBeLessThan(0.6);
  });
});

describe("isGradableInsteadChannel", () => {
  it("only seo, geo and articles are gradable — the channels GSC data actually measures", () => {
    expect(GRADABLE_INSTEAD_CHANNELS).toEqual(["seo", "geo", "articles"]);
    expect(isGradableInsteadChannel("seo")).toBe(true);
    expect(isGradableInsteadChannel("geo")).toBe(true);
    expect(isGradableInsteadChannel("articles")).toBe(true);
  });

  it("channels GSC can't speak to are never gradable, even with strong scores", () => {
    // reddit, x, linkedin, hn: site-wide search data doesn't measure these channels.
    expect(isGradableInsteadChannel("reddit")).toBe(false);
    expect(isGradableInsteadChannel("x")).toBe(false);
    expect(isGradableInsteadChannel("linkedin")).toBe(false);
    expect(isGradableInsteadChannel("hn")).toBe(false);
  });

  it("null (no instead_channel recorded) is never gradable", () => {
    expect(isGradableInsteadChannel(null)).toBe(false);
  });
});

describe("gradeInsteadOutcome", () => {
  it("stays unknown with no qualifying evidence", () => {
    expect(gradeInsteadOutcome([]).outcome).toBe("unknown");
  });

  it("stays unknown when confidence is too low to trust the number", () => {
    const result = gradeInsteadOutcome([{ associationScore: 0.9, confidence: 0.2 }]);
    expect(result.outcome).toBe("unknown");
  });

  it("resolves worked with one strong, confident row", () => {
    const result = gradeInsteadOutcome([{ associationScore: 0.75, confidence: 0.8 }]);
    expect(result.outcome).toBe("worked");
  });

  it("stays unknown when the score doesn't clear the 0.6 band, even with good confidence", () => {
    const result = gradeInsteadOutcome([{ associationScore: 0.55, confidence: 0.8 }]);
    expect(result.outcome).toBe("unknown");
  });

  it("requires agreement — one disagreeing qualifying row pulls the result to unknown", () => {
    const result = gradeInsteadOutcome([
      { associationScore: 0.75, confidence: 0.8 },
      { associationScore: 0.5, confidence: 0.9 },
    ]);
    expect(result.outcome).toBe("unknown");
  });

  it("all qualifying rows must clear the band for worked, not just an average", () => {
    // Average of these two is 0.6, but one row alone doesn't clear the band.
    const result = gradeInsteadOutcome([
      { associationScore: 0.9, confidence: 0.8 },
      { associationScore: 0.3, confidence: 0.8 },
    ]);
    expect(result.outcome).toBe("unknown");
  });

  it("low-confidence rows are ignored, not counted as disagreement", () => {
    const result = gradeInsteadOutcome([
      { associationScore: 0.75, confidence: 0.9 },
      { associationScore: 0.1, confidence: 0.1 }, // below MIN_CONFIDENCE, excluded
    ]);
    expect(result.outcome).toBe("worked");
  });

  it("never produces did_not — this pass only ships worked or unknown", () => {
    const results = [
      gradeInsteadOutcome([{ associationScore: 0.1, confidence: 0.9 }]),
      gradeInsteadOutcome([{ associationScore: 0.4, confidence: 0.9 }]),
      gradeInsteadOutcome([]),
    ];
    for (const r of results) {
      expect(r.outcome).not.toBe("did_not");
    }
  });
});