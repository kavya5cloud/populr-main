import type { AssetKind } from "@/lib/creative/taxonomy";
import type { CreativeBriefInput, CouncilDecision } from "@/lib/creative/types";

// Content Studio — core contracts for the generation orchestration layer.
//
// The whole point of this layer is that NO business logic ever names a vendor. Callers
// speak in modalities, specs and capabilities; concrete providers are swappable adapters
// registered behind these interfaces. Populr owns planning, routing, evaluation and
// storage — providers only turn a spec into raw output.

export type Modality = "image" | "video" | "document" | "voice" | "motion";

export const MODALITIES: Modality[] = ["image", "video", "document", "voice", "motion"];

/** Which modality produces a given asset kind. Keeps pipelines vendor- and kind-agnostic. */
export const MODALITY_FOR_KIND: Partial<Record<AssetKind, Modality>> = {
  hero_video: "video",
  product_demo: "video",
  ugc_video: "video",
  motion_graphic: "motion",
  landing_hero: "image",
  carousel: "image",
  instagram_post: "image",
  infographic: "image",
  advertisement: "image",
  blog: "document",
  linkedin_post: "document",
  x_thread: "document",
  reddit_post: "document",
  email: "document",
  press_release: "document",
  sales_deck: "document",
  case_study: "document",
};

// ---- Specs: the vendor-neutral description of what to make ----

export type BaseSpec = {
  kind: AssetKind;
  /** Human-readable instruction the adapter turns into its own native prompt. */
  prompt: string;
  brief?: CreativeBriefInput;
  /** Free-form, adapter-understood hints (aspect ratio, tone, palette…) — never vendor params. */
  hints?: Record<string, unknown>;
};

export type ImageSpec = BaseSpec & {
  modality: "image";
  aspectRatio?: string;   // e.g. "1:1", "16:9"
  count?: number;         // how many images (carousels/variations)
};

export type VideoSpec = BaseSpec & {
  modality: "video";
  durationSec?: number;
  aspectRatio?: string;
  script?: string;
  scenes?: { description: string; durationSec?: number }[];
};

export type DocumentSpec = BaseSpec & {
  modality: "document";
  format?: string;        // "blog", "press_release", "sales_deck"…
  sections?: string[];
};

export type VoiceSpec = BaseSpec & {
  modality: "voice";
  script: string;
  voice?: string;         // an abstract voice id, not a vendor voice
  durationSec?: number;
};

export type MotionSpec = BaseSpec & {
  modality: "motion";
  durationSec?: number;
  aspectRatio?: string;
  storyboard?: string[];
};

export type GenerationSpec = ImageSpec | VideoSpec | DocumentSpec | VoiceSpec | MotionSpec;

// ---- Provider output: raw result from an adapter ----

export type MediaRef = {
  /** Opaque, provider-independent locator (e.g. populr://media/<hash>). Never a vendor URL. */
  uri: string;
  mime: string;
  bytes?: number;
  width?: number;
  height?: number;
  durationMs?: number;
};

export type ProviderOutput = {
  /** Text content for document/voice-script outputs. */
  content?: string;
  /** One or more media artifacts for image/video/motion/voice outputs. */
  media?: MediaRef[];
  /** Adapter-reported metadata (seed, safety, etc.) — opaque to business logic. */
  meta?: Record<string, unknown>;
};

// ---- Capabilities & cost/latency ----

export type Capabilities = {
  modality: Modality;
  /** Which asset kinds this provider can produce. */
  kinds: AssetKind[];
  maxBatch: number;
  supportsEdit: boolean;
  supportsUpscale: boolean;
  supportsVariations: boolean;
  /** 0..1 quality tier and 0..1 speed tier for routing/estimation. */
  quality: number;
  speed: number;
  /** Abstract cost in credits per unit of output. */
  costPerUnit: number;
};

export type CostEstimate = { credits: number; unit: string; basis: string };
export type LatencyEstimate = { ms: number; basis: string };

export type GenerateOptions = {
  /** Optional progress callback for streaming UIs (router forwards it). */
  onProgress?: (p: { phase: string; pct: number }) => void;
  /** Requested output count (variations/batch). */
  count?: number;
  /** Cap the provider may not exceed; router uses this for cost optimization. */
  maxCredits?: number;
  signal?: AbortSignal;
};

export type EditInstruction = {
  /** The prior output to modify. */
  base: ProviderOutput;
  /** What to change, vendor-neutral. */
  instruction: string;
};

// ---- The provider interface every adapter implements ----

export interface GenerationProvider<S extends GenerationSpec = GenerationSpec> {
  /** Stable, vendor-neutral id (e.g. "reference-image-hq"), unique in the registry. */
  readonly id: string;
  readonly modality: Modality;
  readonly version: string;

  capabilities(): Capabilities;
  /** True when the provider can currently serve traffic. */
  isAvailable(): boolean;

  generate(spec: S, opts?: GenerateOptions): Promise<ProviderOutput>;
  edit(spec: S, edit: EditInstruction, opts?: GenerateOptions): Promise<ProviderOutput>;
  upscale(output: ProviderOutput, opts?: GenerateOptions): Promise<ProviderOutput>;
  variations(spec: S, output: ProviderOutput, count: number, opts?: GenerateOptions): Promise<ProviderOutput>;

  estimateCost(spec: S, opts?: GenerateOptions): CostEstimate;
  estimateLatency(spec: S, opts?: GenerateOptions): LatencyEstimate;
}

// ---- Asynchronous providers ----
//
// GenerationProvider.generate() returns Promise<ProviderOutput>, which assumes the work
// finishes inside the call. That is true of every provider in the registry today and is not
// true of a video model: a task is submitted now and answered in minutes, long after the
// request that started it has returned.
//
// Rather than a parallel hierarchy, an async provider is a GenerationProvider that *also*
// offers submit/poll. Everything already written keeps working untouched — the registry,
// the router, the reference providers and the whole text chain never see these members —
// and a caller that needs the async lifecycle narrows with isAsyncProvider().

/** A provider-side task handle. Never a URL, never a vendor payload. */
export type ProviderTask = { taskId: string; providerId: string };

/**
 * A provider's status, normalized.
 *
 * `terminalSuccess` deliberately requires an output URL as well as a success status: a
 * provider claiming completion without giving us anything to fetch is not a success, and
 * the two must not be separable by a caller reading only one field.
 */
export type ProviderTaskStatus = {
  /** The provider's own string, kept for logs and for recognising new states later. */
  raw: string;
  terminalSuccess: boolean;
  failed: boolean;
  /** Temporary and provider-owned. Never stored as an asset uri, never sent to a browser. */
  outputUrl?: string;
  durationSec?: number;
  ratio?: string;
  resolution?: string;
  error?: string;
};

export interface AsyncGenerationProvider<S extends GenerationSpec = GenerationSpec>
  extends GenerationProvider<S> {
  readonly isAsync: true;
  /** Create the task. Returns as soon as the provider has accepted it. */
  submit(spec: S, opts?: GenerateOptions): Promise<ProviderTask>;
  /** Ask where the task got to. Must never throw for an ordinary provider failure. */
  poll(taskId: string): Promise<ProviderTaskStatus>;
}

export function isAsyncProvider(p: GenerationProvider): p is AsyncGenerationProvider {
  return (p as AsyncGenerationProvider).isAsync === true;
}

// Modality-typed aliases (documentation + explicit registry typing).
export type ImageProvider = GenerationProvider<ImageSpec>;
export type VideoProvider = GenerationProvider<VideoSpec>;
export type DocumentProvider = GenerationProvider<DocumentSpec>;
export type VoiceProvider = GenerationProvider<VoiceSpec>;
export type MotionProvider = GenerationProvider<MotionSpec>;

// ---- Router-level request/result ----

export type GenerationRequest = {
  id?: string;
  spec: GenerationSpec;
  /** Constraints the router honors when picking a provider. */
  constraints?: {
    minQuality?: number;
    maxCredits?: number;
    preferProviderId?: string;
    excludeProviderIds?: string[];
  };
  options?: GenerateOptions;
};

export type GenerationResult = {
  requestId: string;
  modality: Modality;
  kind: AssetKind;
  providerId: string;
  providerVersion: string;
  output: ProviderOutput;
  cost: CostEstimate;
  latencyMs: number;
  promptHash: string;
  cached: boolean;
  attempts: { providerId: string; ok: boolean; error?: string }[];
};

// ---- Generation history & media library records ----

export type ApprovalOutcome = "APPROVED" | "REVISION_REQUIRED" | "REJECTED" | "PENDING";

export type HistoryEntry = {
  id: string;
  createdAt: string;
  workspaceKey: string;
  modality: Modality;
  kind: AssetKind;
  providerId: string;
  providerVersion: string;
  cost: number;
  latencyMs: number;
  promptHash: string;
  cached: boolean;
  brief: CreativeBriefInput | null;
  mission: string | null;
  campaignId: string | null;
  assetRootId: string | null;
  approval: ApprovalOutcome;
  councilScore: number | null;
  performance: Record<string, unknown> | null;
};

export type MediaType =
  | "image" | "video" | "audio" | "template" | "character"
  | "logo" | "font" | "brand_asset" | "motion_asset";

export type MediaItem = {
  id: string;
  createdAt: string;
  workspaceKey: string;
  mediaType: MediaType;
  uri: string;
  mime: string;
  title: string;
  tags: string[];
  kind: AssetKind | null;
  providerId: string | null;
  assetRootId: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  meta: Record<string, unknown> | null;
};

/** The full outcome of a pipeline run (generation + evaluation + persistence refs). */
export type PipelineResult = {
  result: GenerationResult;
  decision: CouncilDecision;
  approval: ApprovalOutcome;
  historyId: string | null;
  mediaId: string | null;
  assetRootId: string | null;
};
