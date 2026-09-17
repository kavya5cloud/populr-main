import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { normalizeBrief } from "@/lib/creative/pipeline";
import { ASSET_KINDS, type AssetKind } from "@/lib/creative/taxonomy";
import { prepareCreative } from "@/lib/creative/brief";
import { idempotencyKeyFor } from "@/lib/creative/jobs";
import { creativeContext, creativeJobs } from "@/lib/creative/shared";
import { submit } from "@/lib/creative/lifecycle";
import { seedanceConfigured } from "@/lib/creative/providers/seedance";
import { storageConfigured } from "@/lib/creative/storage";

export const runtime = "nodejs";

// Start a video generation.
//
// The request creates the job, submits the provider task, and returns. It does not wait for
// the video — that takes minutes, and a Vercel function does not outlive its response. The
// webhook and the sweeper carry it the rest of the way.
export async function POST(req: NextRequest) {
  const session = await getSession();
  // Deliberately tight. Every accepted request can cost money, so the limiter is a spend
  // control here, not just an abuse control.
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 6 : 0, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const key = await workspaceKey((body.wsid as string) ?? null);
  if (!key) return NextResponse.json({ error: "no_key" }, { status: 400 });

  // Refuse before spending anything if the pieces that make a result durable are missing.
  // Submitting without storage would produce a paid video with nowhere to live.
  if (!seedanceConfigured()) return NextResponse.json({ error: "generation_unavailable" }, { status: 503 });
  if (!storageConfigured() && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }

  const assetKind = String(body.assetKind || "hero_video");
  if (!(ASSET_KINDS as readonly string[]).includes(assetKind)) {
    return NextResponse.json({ error: "invalid_kind" }, { status: 422 });
  }

  const prepared = prepareCreative({
    intelligence: {
      assetType: assetKind as AssetKind,
      brief: normalizeBrief((body.brief ?? {}) as Record<string, unknown>),
    },
    durationSec: typeof body.durationSec === "number" ? body.durationSec : undefined,
    aspectRatio: typeof body.aspectRatio === "string" ? body.aspectRatio : undefined,
    // Validated against the single language list; anything unrecognised falls back to the
    // default rather than being passed through.
    language: typeof body.language === "string" ? body.language : undefined,
    profile: (body.profile && typeof body.profile === "object" ? body.profile : null) as Record<string, string> | null,
  });
  if (!prepared.ok) {
    return NextResponse.json({ error: prepared.reason, detail: prepared.detail }, { status: 422 });
  }

  // The nonce is what separates a duplicate from a regeneration. A client that omits it
  // gets one derived from the spec alone, so accidental resubmissions collapse; "Regenerate"
  // sends a fresh nonce and gets a genuinely new generation.
  const nonce = typeof body.nonce === "string" && body.nonce ? body.nonce.slice(0, 64) : "default";
  const idempotencyKey = idempotencyKeyFor(key, prepared.prepared.specHash, nonce);

  const { job, created } = await creativeJobs().create({
    workspaceKey: key,
    idempotencyKey,
    provider: "seedance-video",
    specId: prepared.prepared.spec.id,
    brief: {
      assetKind,
      durationSec: prepared.prepared.durationSec,
      aspectRatio: prepared.prepared.aspectRatio,
      language: prepared.prepared.language,
    },
    // Stored so the job record shows the creative that was actually bought, and so a later
    // phase can diff a regeneration against it.
    storyboard: {
      logline: prepared.prepared.spec.storyStructure?.logline ?? "",
      cta: prepared.prepared.spec.storyStructure?.cta ?? "",
      shots: prepared.prepared.storyboard,
    } as unknown as Record<string, unknown>,
    costEstimate: prepared.prepared.costEstimate,
  });

  // Existing job: return it untouched. This is the guard that stops a double click, a
  // retried fetch or a replayed POST from buying a second video.
  if (!created) {
    return NextResponse.json({ ok: true, id: job.id, status: job.status, duplicate: true });
  }

  const submitted = await submit(creativeContext(), job, prepared.prepared.videoSpec);
  console.info(JSON.stringify({
    event: "creative_submitted", jobId: submitted.id, status: submitted.status,
    // No key, no prompt, no provider task url.
    hasTask: !!submitted.providerTaskId,
  }));

  return NextResponse.json({ ok: true, id: submitted.id, status: submitted.status, duplicate: false });
}
