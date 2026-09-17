import type {
  AsyncGenerationProvider, Capabilities, CostEstimate, EditInstruction, GenerateOptions,
  LatencyEstimate, ProviderOutput, ProviderTask, ProviderTaskStatus, VideoSpec,
} from "@/lib/content/types";
import { SEEDANCE_MVP, MVP_REQUEST, estimateCostUsd } from "@/lib/creative/config";

// The Seedance adapter — the only file in Populr that knows this vendor exists.
//
// Verified against the BytePlus ModelArk documentation (pages last updated 24 August 2026):
//
//   POST {baseUrl}/contents/generations/tasks        → { "id": "cgt-..." }
//   GET  {baseUrl}/contents/generations/tasks/{id}   → { status, content:{video_url}, ... }
//   Authorization: Bearer $ARK_API_KEY
//
// Everything above the adapter speaks ProviderTask / ProviderTaskStatus. Nothing else in
// the codebase imports this file except the registry wiring and the pipeline, and no UI
// string anywhere names the model or the vendor.

const ENV_KEY = "ARK_API_KEY";

/** Endpoint configuration. Region is a variable because BytePlus has more than one. */
function baseUrl(): string {
  return process.env.SEEDANCE_BASE_URL || SEEDANCE_MVP.baseUrl;
}

function model(): string {
  return process.env.SEEDANCE_MODEL || SEEDANCE_MVP.model;
}

export function seedanceConfigured(): boolean {
  return !!process.env[ENV_KEY];
}

/** Provider-side failures, normalized so callers never branch on a vendor string. */
export type SeedanceFailure =
  | "not_configured" | "invalid_api_key" | "rate_limited" | "bad_request"
  | "upstream" | "network" | "malformed_response";

export class SeedanceError extends Error {
  constructor(readonly kind: SeedanceFailure, message: string, readonly status?: number) {
    super(message);
    this.name = "SeedanceError";
  }
}

function classify(status: number): SeedanceFailure {
  if (status === 401 || status === 403) return "invalid_api_key";
  if (status === 429) return "rate_limited";
  if (status >= 400 && status < 500) return "bad_request";
  return "upstream";
}

/** Transient enough to be worth another attempt later. 4xx is not. */
export function isRetryable(kind: SeedanceFailure): boolean {
  return kind === "rate_limited" || kind === "upstream" || kind === "network";
}

async function call(path: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
  const key = process.env[ENV_KEY];
  if (!key) throw new SeedanceError("not_configured", "ARK_API_KEY is not set");

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      ...init,
      signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, ...(init.headers ?? {}) },
    });
  } catch (e) {
    // The key must not reach a log line, and neither must the request body — a network
    // error message can carry the URL, so only the shape of the failure is recorded.
    throw new SeedanceError("network", `request failed: ${String(e).slice(0, 120)}`);
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new SeedanceError(classify(res.status), `provider ${res.status}: ${redact(detail)}`, res.status);
  }
  try {
    return await res.json();
  } catch {
    throw new SeedanceError("malformed_response", "provider returned a non-JSON body");
  }
}

/** Belt-and-braces: never let a key echoed back in an error body reach a log. */
function redact(s: string): string {
  const key = process.env[ENV_KEY];
  return key ? s.split(key).join("[redacted]") : s;
}

// ---------------------------------------------------------------------------
// Request construction
// ---------------------------------------------------------------------------

export type SeedanceRequest = {
  model: string;
  content: { type: "text"; text: string }[];
  ratio: string;
  resolution: string;
  duration: number;
  output_format: string;
  watermark: boolean;
  generate_audio: boolean;
  callback_url?: string;
};

/**
 * Build the verified request body from a VideoSpec.
 *
 * Only documented fields, and only the ones v1 needs. No references (Populr has no brand
 * assets to reference yet, and inventing them would be worse than omitting them), no seed,
 * no camera_fixed, no priority, no safety_identifier — that last one deliberately, because
 * the obvious value to put in it is the user's email and that is not ours to send.
 *
 * generate_audio is explicitly false. The docs default it to true, and silently shipping
 * model-invented audio on a video whose voiceover Populr wrote would be a different product
 * than the one the storyboard describes.
 */
export function buildRequest(spec: VideoSpec, opts: { callbackUrl?: string } = {}): SeedanceRequest {
  const duration = clampDuration(spec.durationSec ?? MVP_REQUEST.durationSec);
  return {
    model: model(),
    content: [{ type: "text", text: spec.prompt }],
    ratio: spec.aspectRatio ?? MVP_REQUEST.ratio,
    resolution: MVP_REQUEST.resolution,
    duration,
    output_format: SEEDANCE_MVP.outputFormat,
    watermark: MVP_REQUEST.watermark,
    generate_audio: MVP_REQUEST.generateAudio,
    ...(opts.callbackUrl ? { callback_url: opts.callbackUrl } : {}),
  };
}

function clampDuration(sec: number): number {
  const n = Math.round(sec);
  if (!Number.isFinite(n)) return MVP_REQUEST.durationSec;
  return Math.min(SEEDANCE_MVP.maxDurationSec, Math.max(SEEDANCE_MVP.minDurationSec, n));
}

// ---------------------------------------------------------------------------
// Response normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a task response.
 *
 * The rule from the spec: an unknown status is never a success and never a failure. It maps
 * to "still running", because a provider that adds a state string must not be able to talk
 * this system into either declaring a video that does not exist or abandoning one that does.
 *
 * `terminalSuccess` additionally requires a usable URL. "succeeded" with no video_url is a
 * malformed response, not a finished video.
 */
export function normalizeStatus(body: unknown): ProviderTaskStatus {
  const b = (body ?? {}) as Record<string, unknown>;
  const raw = typeof b.status === "string" ? b.status : "";
  const content = (b.content ?? {}) as Record<string, unknown>;
  const url = typeof content.video_url === "string" ? content.video_url : undefined;
  const err = b.error && typeof b.error === "object"
    ? String((b.error as Record<string, unknown>).message ?? JSON.stringify(b.error)).slice(0, 300)
    : typeof b.error === "string" ? b.error.slice(0, 300) : undefined;

  const failed = raw === "failed" || raw === "cancelled";
  const succeeded = raw === "succeeded";

  return {
    raw,
    terminalSuccess: succeeded && !!url,
    failed: failed || (succeeded && !url),
    outputUrl: url,
    durationSec: typeof b.duration === "number" ? b.duration : undefined,
    ratio: typeof b.ratio === "string" ? b.ratio : undefined,
    resolution: typeof b.resolution === "string" ? b.resolution : undefined,
    error: err ?? (succeeded && !url ? "provider reported success with no video_url" : undefined),
  };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Seedance as an AsyncGenerationProvider.
 *
 * It implements the full GenerationProvider surface so it can sit in the registry and be
 * described by capabilities(), but generate() rejects: a synchronous call cannot express
 * a task that takes minutes, and quietly blocking would hang a request until the platform
 * killed it. Callers use submit()/poll(). It is deliberately NOT added to defaultProviders()
 * in v1, so the synchronous router can never select it by accident.
 */
export class SeedanceProvider implements AsyncGenerationProvider<VideoSpec> {
  readonly id = "seedance-video";
  readonly modality = "video" as const;
  readonly version = "1.0.0";
  readonly isAsync = true as const;

  constructor(private callbackUrl?: string) {}

  capabilities(): Capabilities {
    return {
      modality: "video",
      kinds: ["hero_video", "product_demo"],
      maxBatch: 1,
      supportsEdit: false,
      supportsUpscale: false,
      supportsVariations: false,
      quality: 0.75,
      speed: 0.3,
      // Credits are not USD. The real money figure comes from estimateCost() below, which
      // returns null when the rate is unconfigured rather than inventing one.
      costPerUnit: 10,
    };
  }

  isAvailable(): boolean { return seedanceConfigured(); }

  async submit(spec: VideoSpec, opts?: GenerateOptions): Promise<ProviderTask> {
    const body = buildRequest(spec, { callbackUrl: this.callbackUrl });
    const res = await call("/contents/generations/tasks", {
      method: "POST",
      body: JSON.stringify(body),
    }, opts?.signal);

    const id = (res as Record<string, unknown>)?.id;
    if (typeof id !== "string" || !id) {
      throw new SeedanceError("malformed_response", "provider did not return a task id");
    }
    return { taskId: id, providerId: this.id };
  }

  async poll(taskId: string): Promise<ProviderTaskStatus> {
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(taskId)) {
      throw new SeedanceError("bad_request", "invalid task id");
    }
    const res = await call(`/contents/generations/tasks/${encodeURIComponent(taskId)}`, { method: "GET" });
    return normalizeStatus(res);
  }

  async generate(): Promise<ProviderOutput> {
    throw new SeedanceError("bad_request", "seedance is asynchronous — use submit()/poll()");
  }
  async edit(_spec: VideoSpec, _edit: EditInstruction): Promise<ProviderOutput> {
    throw new SeedanceError("bad_request", "edit is not enabled for this model in v1");
  }
  async upscale(output: ProviderOutput): Promise<ProviderOutput> { return output; }
  async variations(): Promise<ProviderOutput> {
    throw new SeedanceError("bad_request", "variations are not enabled in v1");
  }

  /**
   * Cost in the registry's own credit unit — one credit per second of output.
   *
   * Deliberately not dollars: CostEstimate is `{credits, unit, basis}` across every
   * provider, and widening it to carry money would mean every caller has to decide what an
   * absent price means. The real USD figure comes from estimateCostUsd(), which returns
   * null when the rate is unconfigured, and the pipeline stores that on the job.
   */
  estimateCost(spec: VideoSpec): CostEstimate {
    const seconds = clampDuration(spec.durationSec ?? MVP_REQUEST.durationSec);
    return { credits: seconds, unit: "second", basis: "output duration" };
  }

  /** An ordering hint, not a promise: generation time is not documented anywhere. */
  estimateLatency(spec: VideoSpec): LatencyEstimate {
    const seconds = clampDuration(spec.durationSec ?? MVP_REQUEST.durationSec);
    return { ms: 60_000 + seconds * 6_000, basis: "unmeasured estimate" };
  }

  /** USD for this spec, or null when no rate is configured. Never a guess. */
  estimateUsd(spec: VideoSpec): number | null {
    return estimateCostUsd(clampDuration(spec.durationSec ?? MVP_REQUEST.durationSec));
  }
}
