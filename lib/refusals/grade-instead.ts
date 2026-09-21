import type { RefusalReason } from "./types";

// Grading insteadOutcome from channel-attributed evidence — an interim measure.
//
// association_score is computed from site-wide Google Search Console metrics
// (impressions, clicks, ctr, position), not from anything specific to a channel.
// The `channel` on a recommendation only tags what it was about; the score itself
// measures whole-site search performance in the window after approval.
//
// For seo, geo and articles that's a defensible proxy — the work IS about search.
// For reddit, x, linkedin and hn, a site-wide search score is measuring something
// those channels barely touch. "We backed LinkedIn and search clicks rose 20%"
// is not evidence LinkedIn worked; it could be caused by anything.
//
// So grading is gated to the channels where the only data we have is actually
// about the same thing the channel is trying to do. The rest stay unknown — not
// because the data is thin, but because no channel-attributed outcome data exists
// for them yet. The real fix is channel-attributed measurement, which doesn't
// exist. This is graded against the only data currently available.
export const GRADABLE_INSTEAD_CHANNELS = ["seo", "geo", "articles"] as const;
export type GradableInsteadChannel = (typeof GRADABLE_INSTEAD_CHANNELS)[number];

export function isGradableInsteadChannel(channel: string | null): channel is GradableInsteadChannel {
  return channel != null && (GRADABLE_INSTEAD_CHANNELS as readonly string[]).includes(channel);
}

/** Only these reasons carry a real "instead" channel worth checking. */
export const GRADABLE_INSTEAD_REASONS: RefusalReason[] = ["better_use_of_time", "low_intent"];

export type ScoredRow = { associationScore: number; confidence: number };

/**
 * 0.5 is exactly "no movement" — associationScore() clips each of four weighted
 * terms (clicks .45, impressions .25, ctr .15, position .15; weights sum to 1.0)
 * into [-1, 1] and adds half of their sum to 0.5. Reaching 0.6 requires the
 * weighted sum to hit +0.2, which — weighted almost half on clicks — means
 * roughly a 45% clicks lift on its own. That's a real move, not noise.
 * See tests/intel-score.test.ts for the score's own math; this just names the
 * bands relative to that documented neutral point.
 */
const WORKED_THRESHOLD = 0.6;
const MIN_CONFIDENCE = 0.5;

export type InsteadGradeResult = { outcome: "worked" | "unknown"; evidence: string };

/**
 * Decide insteadOutcome from every qualifying scored recommendation on the
 * backed channel, generated after the refusal existed. Requires agreement:
 * a single noisy row can call "worked", but if any qualifying row disagrees,
 * the result is "unknown" rather than a coin-flip between them. Fails toward
 * unknown by design — most refusals should stay unknown even once checked.
 *
 * did_not is deliberately not produced here. A site-wide search decline is
 * weak evidence a specific channel bet failed — attribution only runs one way
 * with this data (a rise can support search-related work; a fall doesn't
 * cleanly indict a channel search barely measures). Only "worked" or "unknown"
 * come out of this pass.
 */
export function gradeInsteadOutcome(rows: ScoredRow[]): InsteadGradeResult {
  const qualifying = rows.filter((r) => r.confidence >= MIN_CONFIDENCE);
  if (qualifying.length === 0) {
    return { outcome: "unknown", evidence: "No scored recommendation with enough data volume on this channel yet." };
  }
  const allWorked = qualifying.every((r) => r.associationScore >= WORKED_THRESHOLD);
  if (allWorked) {
    const scores = qualifying.map((r) => r.associationScore.toFixed(2)).join(", ");
    return {
      outcome: "worked",
      evidence: `${qualifying.length} scored recommendation(s) on this channel, association score(s) ${scores} — all at or above the 0.6 "real movement" band.`,
    };
  }
  return {
    outcome: "unknown",
    evidence: `${qualifying.length} scored recommendation(s) on this channel did not agree, or none reached the 0.6 "real movement" band.`,
  };
}