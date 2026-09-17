import type { Sql } from "@/lib/db";
import { NeonMediaRepo, InMemoryMediaRepo, type MediaRepo } from "@/lib/content/media";
import { CREATIVE_LIMITS } from "./config";
import { assetKey, storage, type CreativeStorage } from "./storage";
import { validateBuffer, validateStored } from "./validate";
import { mapProviderStatus, type CreativeJob, type CreativeJobRepo, type CreativeState } from "./jobs";
import { SeedanceError, isRetryable } from "./providers/seedance";
import type { AsyncGenerationProvider, ProviderTaskStatus, VideoSpec } from "@/lib/content/types";

// The creative lifecycle — where the invariant is actually enforced.
//
//   provider success  →  downloading  →  validating  →  stored  →  media_assets  →  ready
//
// Every arrow can fail, and a failure anywhere lands on `failed`, never on `ready`. There
// is exactly one place in this codebase that writes status "ready", and it is at the bottom
// of finalize(), after the asset row exists. That is deliberate: the invariant is easier to
// keep true when there is only one line that could break it.
//
// This module owns no HTTP request lifetime. It is called by the webhook and by the
// sweeper, both of which are short-lived, and it never polls in a loop.

export type Ctx = {
  jobs: CreativeJobRepo;
  media: MediaRepo;
  store: CreativeStorage;
  provider: AsyncGenerationProvider<VideoSpec>;
  /** Injected in tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
};

export function contextFor(sql: Sql | null, provider: AsyncGenerationProvider<VideoSpec>, jobs: CreativeJobRepo): Ctx {
  return {
    jobs,
    media: sql ? new NeonMediaRepo(sql) : new InMemoryMediaRepo(),
    store: storage(),
    provider,
  };
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

/**
 * Send the task to the provider and record its id.
 *
 * Called once per creative job, from the route that created it. If the job already has a
 * provider task id this is a no-op — which is the second half of the idempotency guard: the
 * database prevents a duplicate *job*, and this prevents a duplicate *task* against the
 * same job if the same job is advanced twice concurrently.
 */
export async function submit(ctx: Ctx, job: CreativeJob, spec: VideoSpec): Promise<CreativeJob> {
  if (job.providerTaskId) return job;

  try {
    const task = await ctx.provider.submit(spec);
    return (await ctx.jobs.update(job.id, {
      providerTaskId: task.taskId,
      status: "submitted",
    })) ?? job;
  } catch (e) {
    const kind = e instanceof SeedanceError ? e.kind : "upstream";
    // A retryable submission failure stays non-terminal so the sweeper tries again. A 4xx
    // is our fault and will not fix itself, so it fails now rather than being retried
    // against a paid endpoint forever.
    const status: CreativeState = isRetryable(kind) ? "queued" : "failed";
    return (await ctx.jobs.update(job.id, { status, error: `submit_failed:${kind}` })) ?? job;
  }
}

// ---------------------------------------------------------------------------
// Advancing
// ---------------------------------------------------------------------------

/**
 * Move a job forward based on what the provider now says.
 *
 * The single entry point for both the webhook and the sweeper. Neither of them trusts the
 * payload it received: the webhook re-queries the provider by task id rather than believing
 * a body that arrived over the internet, so a forged callback cannot manufacture a success.
 */
export async function advance(ctx: Ctx, job: CreativeJob): Promise<CreativeJob> {
  if (!job.providerTaskId) return job;
  if (job.status === "ready" || job.status === "failed" || job.status === "cancelled") return job;

  let status: ProviderTaskStatus;
  try {
    status = await ctx.provider.poll(job.providerTaskId);
  } catch (e) {
    const kind = e instanceof SeedanceError ? e.kind : "upstream";
    if (isRetryable(kind)) {
      // Leave it non-terminal and let the sweeper come back. Touching updated_at would hide
      // it from the staleness query, so only the error note is written.
      return (await ctx.jobs.update(job.id, { error: `poll_failed:${kind}` })) ?? job;
    }
    return (await ctx.jobs.update(job.id, { status: "failed", error: `poll_failed:${kind}` })) ?? job;
  }

  if (status.failed) {
    return (await ctx.jobs.update(job.id, {
      status: "failed",
      error: (status.error ?? `provider_${status.raw || "unknown"}`).slice(0, 500),
    })) ?? job;
  }

  if (!status.terminalSuccess) {
    // Includes every unrecognised provider state: mapProviderStatus sends the unknown to
    // "running", never to a terminal one.
    const mapped = mapProviderStatus(status.raw);
    return (await ctx.jobs.update(job.id, { status: mapped })) ?? job;
  }

  // Provider says done and gave us a URL. That is still not an asset.
  return finalize(ctx, job, status);
}

// ---------------------------------------------------------------------------
// Finalization — download, validate, store, record
// ---------------------------------------------------------------------------

async function finalize(ctx: Ctx, job: CreativeJob, status: ProviderTaskStatus): Promise<CreativeJob> {
  const url = status.outputUrl;
  if (!url) return fail(ctx, job, "no_output_url");

  await ctx.jobs.update(job.id, { status: "downloading" });

  // --- download -----------------------------------------------------------
  //
  // The provider's URL is valid for 24 hours and is never stored. It is fetched here, on
  // the server, and the bytes it yields are the only thing that survives this function.
  let bytes: Uint8Array;
  let contentType: string;
  try {
    const doFetch = ctx.fetchImpl ?? fetch;
    const res = await doFetch(url, { redirect: "follow" });
    if (!res.ok) return fail(ctx, job, `download_http_${res.status}`);

    // Refuse an oversized body before reading it into memory when the server declares one.
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > CREATIVE_LIMITS.maxAssetBytes) return fail(ctx, job, "download_too_large");

    contentType = (res.headers.get("content-type") ?? "video/mp4").split(";")[0].trim().toLowerCase();
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    return fail(ctx, job, `download_failed:${String(e).slice(0, 100)}`);
  }

  await ctx.jobs.update(job.id, { status: "validating" });

  // --- validate the bytes -------------------------------------------------
  //
  // Before storage, so a provider error page served with a 200 and a video content-type
  // never reaches the store and never gets an asset row.
  const check = validateBuffer(bytes, contentType, {
    contentType: "video/mp4",
    minBytes: 1024,
    ...(status.durationSec ? { durationSec: status.durationSec, durationToleranceSec: 3 } : {}),
  });
  if (!check.ok) return fail(ctx, job, `invalid_media:${check.reason}${check.detail ? `:${check.detail}` : ""}`);

  // --- store --------------------------------------------------------------
  const key = assetKey(job.workspaceKey, job.id, "mp4");
  try {
    await ctx.store.upload({ key, body: bytes, contentType: "video/mp4" });
  } catch (e) {
    return fail(ctx, job, `storage_failed:${String(e).slice(0, 100)}`);
  }

  // --- prove it can be read back ------------------------------------------
  //
  // Writing and being able to read are different claims. A silent write failure looks
  // exactly like a success until the first person presses play.
  const stored = await validateStored(ctx.store, key, { bytes: check.facts.bytes, contentType: "video/mp4" });
  if (!stored.ok) return fail(ctx, job, `not_retrievable:${stored.reason}`);

  // --- the asset record ---------------------------------------------------
  let assetId: string;
  try {
    const item = await ctx.media.put({
      workspaceKey: job.workspaceKey,
      mediaType: "video",
      // Our storage key, never the provider URL. This is the whole point of the phase.
      uri: key,
      mime: "video/mp4",
      title: "Generated video",
      tags: ["creative", "video"],
      kind: null,
      providerId: job.provider,
      assetRootId: null,
      bytes: check.facts.bytes,
      width: check.facts.width,
      height: check.facts.height,
      // Measured from the container where possible; the provider's claim is recorded
      // separately in meta rather than promoted to a measurement.
      durationMs: check.facts.durationMs,
      meta: {
        creativeJobId: job.id,
        providerTaskId: job.providerTaskId,
        providerReported: {
          durationSec: status.durationSec ?? null,
          ratio: status.ratio ?? null,
          resolution: status.resolution ?? null,
        },
      },
    });
    assetId = item.id;
  } catch (e) {
    // The bytes are stored but unreferenced. Failing here is correct — an asset nothing
    // can find is not an asset — and the orphan is cleaned up rather than left to bill.
    await ctx.store.remove(key).catch(() => {});
    return fail(ctx, job, `asset_record_failed:${String(e).slice(0, 100)}`);
  }

  // The only place "ready" is ever written, and it cannot be reached without assetId.
  return (await ctx.jobs.update(job.id, { status: "ready", assetId })) ?? job;
}

async function fail(ctx: Ctx, job: CreativeJob, reason: string): Promise<CreativeJob> {
  return (await ctx.jobs.update(job.id, { status: "failed", error: reason.slice(0, 500) })) ?? job;
}

// ---------------------------------------------------------------------------
// Sweeper
// ---------------------------------------------------------------------------

/**
 * Recover jobs the webhook did not finish.
 *
 * Bounded on purpose: a fixed batch, and jobs past the provider's 7-day task retention are
 * failed rather than polled forever, because after that window the provider cannot answer
 * for them and a job that can never resolve should say so.
 */
export async function sweep(ctx: Ctx, opts: { now?: number; staleMs?: number; limit?: number } = {}): Promise<{
  examined: number; advanced: number; expired: number;
}> {
  const now = opts.now ?? Date.now();
  const staleMs = opts.staleMs ?? 60_000;
  const due = await ctx.jobs.stale(now - staleMs, opts.limit ?? 20);

  let advanced = 0;
  let expired = 0;
  for (const job of due) {
    const age = now - Date.parse(job.createdAt);
    if (age > 7 * 24 * 60 * 60 * 1000) {
      await fail(ctx, job, "provider_task_expired");
      expired++;
      continue;
    }
    if (!job.providerTaskId) continue;
    await advance(ctx, job);
    advanced++;
  }
  return { examined: due.length, advanced, expired };
}
