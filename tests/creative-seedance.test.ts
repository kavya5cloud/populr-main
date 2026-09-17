import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  SeedanceProvider, SeedanceError, buildRequest, normalizeStatus, seedanceConfigured, isRetryable,
} from "@/lib/creative/providers/seedance";
import { InMemoryStorage } from "@/lib/creative/storage";
import { InMemoryMediaRepo } from "@/lib/content/media";
import { InMemoryCreativeJobRepo, isReady, type CreativeJob } from "@/lib/creative/jobs";
import { submit, advance, sweep, type Ctx } from "@/lib/creative/lifecycle";
import { SEEDANCE_MVP, MVP_REQUEST } from "@/lib/creative/config";
import { isAsyncProvider } from "@/lib/content/types";
import type { AsyncGenerationProvider, ProviderTaskStatus, VideoSpec } from "@/lib/content/types";

// Phase 10B — real video generation, with the provider mocked throughout.
//
// No test here makes a paid call. fetch is stubbed for the adapter tests, and the lifecycle
// tests drive a fake provider that implements the same AsyncGenerationProvider interface.

const WS = "user:alice";

const SPEC: VideoSpec = {
  kind: "hero_video", modality: "video", prompt: "A 10-second reel announcing an AI CMO",
  durationSec: 10, aspectRatio: "9:16", hints: {},
} as VideoSpec;

function mp4(bytes = 4096): Uint8Array {
  const b = new Uint8Array(bytes);
  b.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d], 0);
  return b;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function videoResponse(bytes = mp4(), contentType = "video/mp4") {
  return new Response(bytes.buffer as ArrayBuffer, {
    status: 200,
    headers: { "content-type": contentType, "content-length": String(bytes.byteLength) },
  });
}

describe("seedance request construction", () => {
  it("sends only verified fields, with the configured model", () => {
    const r = buildRequest(SPEC);
    expect(r.model).toBe(SEEDANCE_MVP.model);
    expect(r.content).toEqual([{ type: "text", text: SPEC.prompt }]);
    expect(r.ratio).toBe("9:16");
    expect(r.resolution).toBe("720p");
    expect(r.duration).toBe(10);
    expect(r.output_format).toBe("mp4");

    // Nothing speculative: no seed, camera_fixed, priority, or safety_identifier.
    expect(Object.keys(r).sort()).toEqual([
      "content", "duration", "generate_audio", "model", "output_format", "ratio", "resolution", "watermark",
    ]);
  });

  it("does not generate audio, whatever the provider defaults to", () => {
    // The docs default generate_audio to true. Shipping model-invented audio over a
    // storyboard whose voiceover Populr wrote would be a different product.
    expect(buildRequest(SPEC).generate_audio).toBe(false);
    expect(MVP_REQUEST.generateAudio).toBe(false);
  });

  it("never includes a reference or a user identifier", () => {
    const s = JSON.stringify(buildRequest(SPEC));
    for (const forbidden of ["image_url", "video_url", "reference", "safety_identifier", "@"]) {
      expect(s, forbidden).not.toContain(forbidden);
    }
  });

  it("clamps duration into the model's documented range", () => {
    expect(buildRequest({ ...SPEC, durationSec: 1 }).duration).toBe(SEEDANCE_MVP.minDurationSec);
    expect(buildRequest({ ...SPEC, durationSec: 999 }).duration).toBe(SEEDANCE_MVP.maxDurationSec);
    expect(buildRequest({ ...SPEC, durationSec: NaN }).duration).toBe(MVP_REQUEST.durationSec);
  });

  it("includes a callback url only when one is configured", () => {
    expect(buildRequest(SPEC).callback_url).toBeUndefined();
    expect(buildRequest(SPEC, { callbackUrl: "https://x.test/cb" }).callback_url).toBe("https://x.test/cb");
  });
});

describe("seedance status normalization", () => {
  it("succeeded with a url is the only terminal success", () => {
    const s = normalizeStatus({ status: "succeeded", content: { video_url: "https://x/v.mp4" } });
    expect(s.terminalSuccess).toBe(true);
    expect(s.failed).toBe(false);
    expect(s.outputUrl).toBe("https://x/v.mp4");
  });

  it("succeeded WITHOUT a url is a failure, not a success", () => {
    const s = normalizeStatus({ status: "succeeded", content: {} });
    expect(s.terminalSuccess).toBe(false);
    expect(s.failed).toBe(true);
    expect(s.error).toMatch(/no video_url/);
  });

  it("treats unknown statuses as non-terminal", () => {
    for (const raw of ["", "processing", "PENDING_REVIEW", "something_new"]) {
      const s = normalizeStatus({ status: raw });
      expect(s.terminalSuccess, raw).toBe(false);
      expect(s.failed, raw).toBe(false);
    }
  });

  it("carries the provider's reported facts without promoting them to measurements", () => {
    const s = normalizeStatus({
      status: "succeeded", content: { video_url: "https://x/v.mp4" },
      duration: 10, ratio: "9:16", resolution: "720p",
    });
    expect(s).toMatchObject({ durationSec: 10, ratio: "9:16", resolution: "720p" });
  });

  it("reads a provider error object", () => {
    const s = normalizeStatus({ status: "failed", error: { message: "content policy" } });
    expect(s.failed).toBe(true);
    expect(s.error).toContain("content policy");
  });
});

describe("seedance transport", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => { process.env.ARK_API_KEY = "test-key-abc"; });
  afterEach(() => { globalThis.fetch = realFetch; delete process.env.ARK_API_KEY; });

  it("authenticates with a bearer token and hits the verified endpoint", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return jsonResponse({ id: "cgt-123" });
    }) as unknown as typeof fetch;

    const task = await new SeedanceProvider().submit(SPEC);
    expect(task).toEqual({ taskId: "cgt-123", providerId: "seedance-video" });
    expect(seen!.url).toBe(`${SEEDANCE_MVP.baseUrl}/contents/generations/tasks`);
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe("Bearer test-key-abc");
  });

  it("refuses to call anything without a key", async () => {
    delete process.env.ARK_API_KEY;
    expect(seedanceConfigured()).toBe(false);
    await expect(new SeedanceProvider().submit(SPEC)).rejects.toMatchObject({ kind: "not_configured" });
  });

  it("classifies provider failures and marks the retryable ones", async () => {
    const cases: [number, string, boolean][] = [
      [401, "invalid_api_key", false],
      [403, "invalid_api_key", false],
      [429, "rate_limited", true],
      [400, "bad_request", false],
      [500, "upstream", true],
    ];
    for (const [status, kind, retryable] of cases) {
      globalThis.fetch = (async () => jsonResponse({ error: "x" }, status)) as unknown as typeof fetch;
      await expect(new SeedanceProvider().submit(SPEC)).rejects.toMatchObject({ kind });
      expect(isRetryable(kind as never), kind).toBe(retryable);
    }
  });

  it("never lets the api key appear in an error message", async () => {
    globalThis.fetch = (async () =>
      new Response("bad key: test-key-abc", { status: 401 })) as unknown as typeof fetch;
    const err: unknown = await new SeedanceProvider().submit(SPEC).catch((e) => e);
    const message = (err as SeedanceError).message;
    expect(message).not.toContain("test-key-abc");
    expect(message).toContain("[redacted]");
  });

  it("rejects a response with no task id", async () => {
    globalThis.fetch = (async () => jsonResponse({ nope: true })) as unknown as typeof fetch;
    await expect(new SeedanceProvider().submit(SPEC)).rejects.toMatchObject({ kind: "malformed_response" });
  });

  it("refuses a malformed task id rather than putting it in a url", async () => {
    await expect(new SeedanceProvider().poll("../../admin")).rejects.toMatchObject({ kind: "bad_request" });
  });

  it("is async, and its synchronous generate() refuses instead of blocking", async () => {
    const p = new SeedanceProvider();
    expect(isAsyncProvider(p)).toBe(true);
    await expect(p.generate()).rejects.toThrow(/asynchronous/);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

class FakeProvider implements AsyncGenerationProvider<VideoSpec> {
  readonly id = "seedance-video";
  readonly modality = "video" as const;
  readonly version = "test";
  readonly isAsync = true as const;
  submits = 0;
  constructor(private script: ProviderTaskStatus[] = [], private failSubmit?: Error) {}
  capabilities() { return { modality: "video", kinds: [], maxBatch: 1, supportsEdit: false, supportsUpscale: false, supportsVariations: false, quality: 0.7, speed: 0.3, costPerUnit: 10 } as never; }
  isAvailable() { return true; }
  async submit() {
    this.submits++;
    if (this.failSubmit) throw this.failSubmit;
    return { taskId: `cgt-${this.submits}`, providerId: this.id };
  }
  async poll(): Promise<ProviderTaskStatus> {
    return this.script.shift() ?? { raw: "running", terminalSuccess: false, failed: false };
  }
  async generate(): Promise<never> { throw new Error("async"); }
  async edit(): Promise<never> { throw new Error("async"); }
  async upscale(o: never): Promise<never> { return o; }
  async variations(): Promise<never> { throw new Error("async"); }
  estimateCost() { return { credits: 10, unit: "second", basis: "t" }; }
  estimateLatency() { return { ms: 1000, basis: "t" }; }
}

function ctxWith(provider: AsyncGenerationProvider<VideoSpec>, fetchImpl?: typeof fetch): Ctx & { store: InMemoryStorage } {
  const store = new InMemoryStorage();
  return { jobs: new InMemoryCreativeJobRepo(), media: new InMemoryMediaRepo(), store, provider, fetchImpl };
}

async function newJob(ctx: Ctx, idem = "k1"): Promise<CreativeJob> {
  const { job } = await ctx.jobs.create({ workspaceKey: WS, idempotencyKey: idem, provider: "seedance-video" });
  return job;
}

const SUCCESS: ProviderTaskStatus = {
  raw: "succeeded", terminalSuccess: true, failed: false,
  outputUrl: "https://provider.test/tmp/v.mp4", durationSec: 10,
};

describe("submission", () => {
  it("records the provider task id and moves to submitted", async () => {
    const ctx = ctxWith(new FakeProvider());
    const out = await submit(ctx, await newJob(ctx), SPEC);
    expect(out.providerTaskId).toBe("cgt-1");
    expect(out.status).toBe("submitted");
  });

  it("never submits twice for the same job", async () => {
    const provider = new FakeProvider();
    const ctx = ctxWith(provider);
    const job = await newJob(ctx);
    const once = await submit(ctx, job, SPEC);
    await submit(ctx, once, SPEC);
    expect(provider.submits).toBe(1);
  });

  it("stays retryable on a transient failure and fails hard on a 4xx", async () => {
    const transient = ctxWith(new FakeProvider([], new SeedanceError("rate_limited", "429")));
    expect((await submit(transient, await newJob(transient), SPEC)).status).toBe("queued");

    const permanent = ctxWith(new FakeProvider([], new SeedanceError("bad_request", "400")));
    expect((await submit(permanent, await newJob(permanent), SPEC)).status).toBe("failed");
  });
});

describe("the ready invariant", () => {
  it("provider success with a failed download can never be ready", async () => {
    const ctx = ctxWith(new FakeProvider([SUCCESS]), (async () => new Response("nope", { status: 500 })) as never);
    const job = await submit(ctx, await newJob(ctx), SPEC);
    const out = await advance(ctx, job);

    expect(out.status).toBe("failed");
    expect(out.assetId).toBeNull();
    expect(isReady(out)).toBe(false);
    expect(out.error).toContain("download_http_500");
  });

  it("provider success with corrupt bytes can never be ready", async () => {
    const html = new TextEncoder().encode("<html>error</html>".padEnd(2000, " "));
    const ctx = ctxWith(new FakeProvider([SUCCESS]), (async () => videoResponse(html)) as never);
    const out = await advance(ctx, await submit(ctx, await newJob(ctx), SPEC));

    expect(out.status).toBe("failed");
    expect(out.error).toContain("corrupt_or_not_mp4");
    expect(ctx.store.count()).toBe(0);   // nothing reached storage
  });

  it("provider success with the wrong media type can never be ready", async () => {
    const ctx = ctxWith(new FakeProvider([SUCCESS]), (async () => videoResponse(mp4(), "text/html")) as never);
    const out = await advance(ctx, await submit(ctx, await newJob(ctx), SPEC));
    expect(out.status).toBe("failed");
    expect(out.error).toContain("invalid_media");
  });

  it("provider success with an empty body can never be ready", async () => {
    const ctx = ctxWith(new FakeProvider([SUCCESS]), (async () => videoResponse(new Uint8Array(0))) as never);
    const out = await advance(ctx, await submit(ctx, await newJob(ctx), SPEC));
    expect(out.status).toBe("failed");
  });

  it("a storage failure can never be ready, and leaves no asset behind", async () => {
    const ctx = ctxWith(new FakeProvider([SUCCESS]), (async () => videoResponse()) as never);
    ctx.store.upload = async () => { throw new Error("blob down"); };
    const out = await advance(ctx, await submit(ctx, await newJob(ctx), SPEC));

    expect(out.status).toBe("failed");
    expect(out.error).toContain("storage_failed");
    expect(await ctx.media.search({ workspaceKey: WS })).toHaveLength(0);
  });

  it("a write that cannot be read back is not ready", async () => {
    const ctx = ctxWith(new FakeProvider([SUCCESS]), (async () => videoResponse()) as never);
    // Accept the write, then report the object missing — a silent write failure.
    ctx.store.stat = async () => null;
    const out = await advance(ctx, await submit(ctx, await newJob(ctx), SPEC));
    expect(out.status).toBe("failed");
    expect(out.error).toContain("not_retrievable");
  });

  it("no state other than ready ever carries an asset id", async () => {
    const ctx = ctxWith(new FakeProvider([{ raw: "running", terminalSuccess: false, failed: false }]));
    const out = await advance(ctx, await submit(ctx, await newJob(ctx), SPEC));
    expect(out.status).toBe("running");
    expect(out.assetId).toBeNull();
  });
});

describe("the full happy path", () => {
  it("create → submit → running → succeeded → download → validate → store → ready", async () => {
    const provider = new FakeProvider([
      { raw: "queued", terminalSuccess: false, failed: false },
      { raw: "running", terminalSuccess: false, failed: false },
      SUCCESS,
    ]);
    const bytes = mp4(8192);
    const ctx = ctxWith(provider, (async () => videoResponse(bytes)) as never);

    let job = await submit(ctx, await newJob(ctx), SPEC);
    expect(job.status).toBe("submitted");

    job = await advance(ctx, job);
    expect(job.status).toBe("submitted");   // provider "queued"

    job = await advance(ctx, job);
    expect(job.status).toBe("running");

    job = await advance(ctx, job);
    expect(job.status).toBe("ready");
    expect(isReady(job)).toBe(true);

    // The asset is real, stored under our key, and the provider URL is nowhere near it.
    const asset = await ctx.media.get(job.assetId!);
    expect(asset).not.toBeNull();
    expect(asset!.mime).toBe("video/mp4");
    expect(asset!.bytes).toBe(8192);
    expect(asset!.workspaceKey).toBe(WS);
    expect(asset!.uri).not.toContain("provider.test");
    expect(asset!.uri).not.toContain("populr://");
    expect(asset!.uri).toMatch(/^creative\//);
    expect(await ctx.store.stat(asset!.uri)).not.toBeNull();
  });

  it("stores our storage key, never the expiring provider url", async () => {
    const ctx = ctxWith(new FakeProvider([SUCCESS]), (async () => videoResponse()) as never);
    const job = await advance(ctx, await submit(ctx, await newJob(ctx), SPEC));
    const asset = await ctx.media.get(job.assetId!);
    expect(asset!.uri).not.toBe(SUCCESS.outputUrl);
    expect(asset!.meta).toMatchObject({ creativeJobId: job.id });
  });

  it("a terminal job is never advanced again", async () => {
    const ctx = ctxWith(new FakeProvider([SUCCESS]), (async () => videoResponse()) as never);
    const ready = await advance(ctx, await submit(ctx, await newJob(ctx), SPEC));
    const again = await advance(ctx, ready);
    expect(again.status).toBe("ready");
    expect(again.assetId).toBe(ready.assetId);
  });
});

describe("failure and recovery", () => {
  it("a provider failure is terminal and carries the reason", async () => {
    const ctx = ctxWith(new FakeProvider([{ raw: "failed", terminalSuccess: false, failed: true, error: "content policy" }]));
    const out = await advance(ctx, await submit(ctx, await newJob(ctx), SPEC));
    expect(out.status).toBe("failed");
    expect(out.error).toContain("content policy");
  });

  it("the sweeper advances stale work and leaves finished work alone", async () => {
    const ctx = ctxWith(new FakeProvider([SUCCESS]), (async () => videoResponse()) as never);
    await submit(ctx, await newJob(ctx, "a"), SPEC);

    const result = await sweep(ctx, { now: Date.now() + 120_000, staleMs: 60_000 });
    expect(result.advanced).toBe(1);

    const after = await sweep(ctx, { now: Date.now() + 240_000, staleMs: 60_000 });
    expect(after.examined).toBe(0);   // the job is ready and no longer stale
  });

  it("fails a job past the provider's 7-day task retention instead of polling forever", async () => {
    const ctx = ctxWith(new FakeProvider());
    const job = await submit(ctx, await newJob(ctx), SPEC);
    const eightDays = Date.now() + 8 * 24 * 60 * 60 * 1000;

    const result = await sweep(ctx, { now: eightDays, staleMs: 1000 });
    expect(result.expired).toBe(1);
    const after = await ctx.jobs.get(job.id, WS);
    expect(after!.status).toBe("failed");
    expect(after!.error).toBe("provider_task_expired");
  });
});

describe("webhook safety", () => {
  it("a task id resolves to exactly one job, and its workspace comes from our record", async () => {
    const ctx = ctxWith(new FakeProvider());
    const mine = await submit(ctx, await newJob(ctx, "mine"), SPEC);

    const found = await ctx.jobs.findByTask(mine.providerTaskId!);
    expect(found!.id).toBe(mine.id);
    // The workspace is never taken from the callback.
    expect(found!.workspaceKey).toBe(WS);
  });

  it("an unknown task id resolves to nothing", async () => {
    const ctx = ctxWith(new FakeProvider());
    expect(await ctx.jobs.findByTask("cgt-does-not-exist")).toBeNull();
  });

  it("a job with no provider task is never advanced", async () => {
    const ctx = ctxWith(new FakeProvider([SUCCESS]));
    const job = await newJob(ctx);
    expect((await advance(ctx, job)).status).toBe("queued");
  });
});

describe("regeneration", () => {
  it("a new nonce produces a second job and a second provider task", async () => {
    const provider = new FakeProvider();
    const ctx = ctxWith(provider);
    const a = await submit(ctx, await newJob(ctx, "spec:nonce-1"), SPEC);
    const b = await submit(ctx, await newJob(ctx, "spec:nonce-2"), SPEC);

    expect(a.id).not.toBe(b.id);
    expect(a.providerTaskId).not.toBe(b.providerTaskId);
    expect(provider.submits).toBe(2);
  });

  it("the same nonce reuses the job and buys nothing twice", async () => {
    const provider = new FakeProvider();
    const ctx = ctxWith(provider);
    const first = await ctx.jobs.create({ workspaceKey: WS, idempotencyKey: "same", provider: "seedance-video" });
    const second = await ctx.jobs.create({ workspaceKey: WS, idempotencyKey: "same", provider: "seedance-video" });

    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    await submit(ctx, first.job, SPEC);
    expect(provider.submits).toBe(1);
  });
});

describe("existing providers are untouched", () => {
  it("the reference providers are still synchronous and still registered", async () => {
    const { defaultProviders } = await import("@/lib/content/providers");
    const providers = defaultProviders();
    expect(providers.length).toBeGreaterThan(0);
    for (const p of providers) {
      expect(isAsyncProvider(p), p.id).toBe(false);
      expect(typeof p.generate).toBe("function");
    }
  });

  it("seedance is not in the default registry, so the sync router cannot pick it", async () => {
    const { defaultProviders } = await import("@/lib/content/providers");
    expect(defaultProviders().map((p) => p.id)).not.toContain("seedance-video");
  });

  it("the text provider chain is unchanged", async () => {
    const { PROVIDERS } = await import("@/lib/services/llm");
    expect(PROVIDERS.map((p) => p.name)).toEqual(["gemini", "groq", "openai", "sarvam"]);
  });
});
