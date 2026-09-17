// Creative Engine configuration. Server-side only.
//
// Every number a media provider needs lives here rather than in a component, so the MVP's
// shape is one file to read and one file to change. A UI that hardcodes "720p" becomes a
// second source of truth the day someone raises the cap, and then the screen and the
// invoice disagree.
//
// The values below were verified against the BytePlus ModelArk documentation (pages last
// updated 24 August 2026). Nothing here is a guess; where the docs did not state a number,
// the field is absent rather than filled in with a plausible one.

/** Provider limits for the model the MVP will use. Facts, not preferences. */
export const SEEDANCE_MVP = {
  /** Verbatim model id from the ModelArk model list. */
  model: "dreamina-seedance-2-0-mini-260615",
  /** ap-southeast-1. The EU base url is https://ark.eu-west.bytepluses.com/api/v3 . */
  baseUrl: "https://ark.ap-southeast.bytepluses.com/api/v3",
  /** Documented range for this model: 4–15s. The MVP does not use the full range. */
  minDurationSec: 4,
  maxDurationSec: 15,
  /** This model supports 480p and 720p only — 1080p belongs to other models. */
  resolutions: ["480p", "720p"] as const,
  /** Documented aspect ratios, all models. */
  ratios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const,
  fps: 24,
  outputFormat: "mp4",
  /**
   * How long the provider's own video_url stays valid. Documented as 24 hours, and the
   * single most important number in this whole subsystem: it is why storage exists.
   */
  outputUrlTtlMs: 24 * 60 * 60 * 1000,
  /** Provider task records are queryable for 7 days. A sweeper older than this is useless. */
  taskRetentionMs: 7 * 24 * 60 * 60 * 1000,
} as const;

/** What the first MVP actually asks for — a deliberate subset of what the model allows. */
export const MVP_REQUEST = {
  resolution: "720p",
  ratio: "9:16",
  durationSec: 10,
  generateAudio: false,
  watermark: false,
} as const;

/**
 * Ceilings for a single generation. These are refusals, not preferences: a request past
 * one of them is rejected before any provider is called, because the cost of finding out
 * afterwards is a charge on a real card.
 */
export const CREATIVE_LIMITS = {
  maxDurationSec: 15,
  maxShots: 6,
  /** A 15s 720p mp4 is single-digit megabytes; 200MB is a wrong-file tripwire, not a quota. */
  maxAssetBytes: 200 * 1024 * 1024,
  /** Nothing else is stored by the Creative Engine yet. Extended when a modality is real. */
  allowedMimes: ["video/mp4"] as const,
} as const;

export type CreativeResolution = (typeof SEEDANCE_MVP.resolutions)[number];
export type CreativeRatio = (typeof SEEDANCE_MVP.ratios)[number];

/**
 * Cost per second, if it has been configured. Deliberately not a literal.
 *
 * The published rates are promotional (Seedance 2.0 mini at 720p was "from approximately
 * USD 0.03 per second" during a window ending 7 September 2026) and "approximately" is not
 * a number a spend guard can be built on. Baking today's promo price into the source would
 * produce an estimate that silently becomes wrong when the promotion ends — which is worse
 * than having no estimate, because it looks like knowledge.
 *
 * So: read it from the environment, and return null when it is unset. Callers must handle
 * null by declining to display a price, never by falling back to a guess.
 */
export function costPerSecondUsd(): number | null {
  const raw = process.env.SEEDANCE_USD_PER_SECOND;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Estimated USD for a generation, or null when the rate is unknown. Never a guess. */
export function estimateCostUsd(durationSec: number): number | null {
  const rate = costPerSecondUsd();
  if (rate == null) return null;
  return Math.round(rate * durationSec * 10000) / 10000;
}
