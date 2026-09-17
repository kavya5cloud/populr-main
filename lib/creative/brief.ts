import {
  buildSpecification, buildScript, toProviderSpec, validateSpecification,
  type GenerationSpecification, type IntelligenceInput, type Script,
} from "@/lib/creative-intelligence";
import { DEFAULT_LANGUAGE, isLanguageCode, type LanguageCode } from "@/lib/i18n/languages";
import { buildVideoPrompt, storyboardOf, type StoryboardShot } from "./video-prompt";
import type { WorkspaceProfile } from "./studio-brief";
import type { VideoSpec } from "@/lib/content/types";
import { CREATIVE_LIMITS, MVP_REQUEST, SEEDANCE_MVP, estimateCostUsd } from "./config";
import { specHashOf } from "./jobs";

// The adapter between Populr's creative intelligence and a media provider.
//
// This file is deliberately thin, and it is worth saying why, because the obvious instinct
// is to write a CreativeBrief type here. There already is one. lib/creative-intelligence/
// owns GenerationSpecification, Story → Act → Scene → Shot, VisualPlan, Hook, Script and
// Character, and lib/creative-intelligence/contract.ts already turns a specification into
// a modality-typed VideoSpec with duration, aspect ratio, script and scenes.
//
// A second brief type would be a second thing to keep in step, and the two would diverge on
// the first day someone edited only one. So nothing is redefined below. What is added is
// the part the Creative Engine genuinely needs and the intelligence layer has no opinion
// about: whether a request fits inside the limits of the model we are paying for, and what
// it will cost to find out.

export type CreativeRequest = {
  /** Everything the intelligence layer already knows how to reason over. */
  intelligence: IntelligenceInput;
  /** Seconds. Bounded by the model and by CREATIVE_LIMITS, checked below. */
  durationSec?: number;
  aspectRatio?: string;
  resolution?: string;
  /** Uses the one language list in lib/i18n. Never a second copy. */
  language?: LanguageCode | string;
  /** The workspace's business context, when it has been analysed. Never invented. */
  profile?: WorkspaceProfile | null;
};

export type PreparedCreative = {
  spec: GenerationSpecification;
  /** What a provider adapter will consume. Produced by the existing contract layer. */
  videoSpec: VideoSpec;
  durationSec: number;
  aspectRatio: string;
  resolution: string;
  language: LanguageCode;
  /** Written by the intelligence layer, not here. Supplies the on-screen text. */
  script: Script;
  /** What Studio renders. Same specification, same fitting as the prompt. */
  storyboard: StoryboardShot[];
  /** Stable across identical requests — half of the idempotency key. */
  specHash: string;
  /** USD, or null when the rate is not configured. Never a placeholder number. */
  costEstimate: number | null;
};

export type PrepareFailure = { ok: false; reason: string; detail?: string };
export type PrepareSuccess = { ok: true; prepared: PreparedCreative };
export type PrepareResult = PrepareSuccess | PrepareFailure;

/**
 * Turn a creative request into something a provider could render — or refuse it.
 *
 * Refusal happens here, before a provider adapter exists and long before one is called.
 * That ordering is the point: the cheapest place to reject an 80-second video is the one
 * that has not yet spent anything finding out it was too long.
 */
export function prepareCreative(req: CreativeRequest): PrepareResult {
  const durationSec = req.durationSec ?? MVP_REQUEST.durationSec;
  const aspectRatio = req.aspectRatio ?? MVP_REQUEST.ratio;
  const resolution = req.resolution ?? MVP_REQUEST.resolution;
  const lang: LanguageCode = isLanguageCode(req.language) ? req.language : DEFAULT_LANGUAGE;

  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return { ok: false, reason: "invalid_duration" };
  }
  // Two separate ceilings, and both are real. The model cannot go below 4s or above 15s;
  // CREATIVE_LIMITS is our own spend boundary, which may be tighter but never looser.
  if (durationSec < SEEDANCE_MVP.minDurationSec || durationSec > SEEDANCE_MVP.maxDurationSec) {
    return {
      ok: false, reason: "duration_out_of_range",
      detail: `${SEEDANCE_MVP.minDurationSec}-${SEEDANCE_MVP.maxDurationSec}s`,
    };
  }
  if (durationSec > CREATIVE_LIMITS.maxDurationSec) {
    return { ok: false, reason: "duration_over_limit", detail: `${CREATIVE_LIMITS.maxDurationSec}s` };
  }
  if (!(SEEDANCE_MVP.ratios as readonly string[]).includes(aspectRatio)) {
    return { ok: false, reason: "unsupported_aspect_ratio", detail: aspectRatio };
  }
  if (!(SEEDANCE_MVP.resolutions as readonly string[]).includes(resolution)) {
    return { ok: false, reason: "unsupported_resolution", detail: resolution };
  }

  const spec = buildSpecification({
    ...req.intelligence,
    // The intelligence layer reasons about story and craft; the numbers below are the
    // commercial envelope, so they are stamped on afterwards rather than inferred.
  });
  spec.providerRequirements = {
    ...spec.providerRequirements,
    modality: "video",
    durationSec,
    aspectRatio,
  };

  const validation = validateSpecification(spec);
  if (!validation.ok) {
    return {
      ok: false, reason: "invalid_specification",
      detail: validation.errors.map((e) => `${e.field}: ${e.message}`).join("; ").slice(0, 300),
    };
  }

  const shots = spec.storyStructure?.acts.flatMap((a) => a.scenes).length ?? 0;
  if (shots > CREATIVE_LIMITS.maxShots) {
    return { ok: false, reason: "too_many_shots", detail: `${shots} > ${CREATIVE_LIMITS.maxShots}` };
  }

  const videoSpec = toProviderSpec(spec) as VideoSpec;
  if (videoSpec.modality !== "video") {
    return { ok: false, reason: "not_a_video_request", detail: videoSpec.modality };
  }

  // The script is the intelligence layer's, not ours — buildScript already derives it from
  // the same story. It is read here only for on-screen text; nothing rewrites it.
  const script = buildScript(req.intelligence.brief, req.intelligence.assetType, {
    story: spec.storyStructure ?? undefined,
    hook: spec.hook,
  });

  // The brief travels with the spec so the prompt builder can tell real copy from the
  // script engine's placeholders. Without it every empty field becomes on-screen text.
  const promptInput = {
    spec, durationSec, aspectRatio, languageCode: lang, script,
    brief: req.intelligence.brief, profile: req.profile ?? null,
  };
  const storyboard = storyboardOf(promptInput);
  if (!storyboard.length) return { ok: false, reason: "empty_storyboard" };
  if (storyboard.some((s) => s.durationSec < 1)) return { ok: false, reason: "invalid_shot_duration" };
  if (storyboard.reduce((n, s) => n + s.durationSec, 0) !== durationSec) {
    return { ok: false, reason: "storyboard_duration_mismatch" };
  }

  // The provider sees Populr's creative direction, never the raw request sentence.
  videoSpec.prompt = buildVideoPrompt(promptInput);
  if (!videoSpec.prompt.trim()) return { ok: false, reason: "empty_prompt" };

  return {
    ok: true,
    prepared: {
      spec, videoSpec, durationSec, aspectRatio, resolution, language: lang, script, storyboard,
      // Hashed from the provider-facing spec plus the commercial envelope, because two
      // requests that differ only in duration are different generations with different
      // prices and must not collapse into one.
      specHash: specHashOf({ prompt: videoSpec.prompt, durationSec, aspectRatio, resolution, lang }),
      costEstimate: estimateCostUsd(durationSec),
    },
  };
}

/**
 * The storyboard, flattened to what a provider needs per shot.
 *
 * Reads from the existing Story model rather than holding one. Nothing is invented: if the
 * intelligence layer produced no story, this returns an empty list and the caller decides
 * what that means, rather than receiving a fabricated single shot.
 */
export function shotsOf(spec: GenerationSpecification): { description: string; durationSec: number; camera: string }[] {
  const scenes = spec.storyStructure?.acts.flatMap((a) => a.scenes) ?? [];
  return scenes.map((s) => ({
    description: s.visualObjective,
    durationSec: s.durationSec,
    camera: s.camera,
  }));
}
