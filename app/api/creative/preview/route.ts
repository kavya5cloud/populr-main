import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { normalizeBrief } from "@/lib/creative/pipeline";
import { ASSET_KINDS, type AssetKind } from "@/lib/creative/taxonomy";
import { prepareCreative } from "@/lib/creative/brief";

export const runtime = "nodejs";

// The storyboard Studio shows before anything is spent.
//
// It calls the same prepareCreative() the generate route calls, so the shots on screen are
// the shots in the provider prompt — not a second rendering that could drift. Free and
// deterministic: no model call, no provider call, no job, no cost.
//
// The prompt itself is not returned. It is Populr's creative direction and there is no
// reason to publish it to a browser; the storyboard is the readable form of the same thing.
export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 60 : 20, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

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
    language: typeof body.language === "string" ? body.language : undefined,
    profile: (body.profile && typeof body.profile === "object" ? body.profile : null) as Record<string, string> | null,
  });
  if (!prepared.ok) {
    return NextResponse.json({ error: prepared.reason, detail: prepared.detail }, { status: 422 });
  }

  return NextResponse.json({
    ok: true,
    logline: prepared.prepared.spec.storyStructure?.logline ?? "",
    tone: prepared.prepared.spec.tone,
    audience: prepared.prepared.spec.audience,
    durationSec: prepared.prepared.durationSec,
    aspectRatio: prepared.prepared.aspectRatio,
    language: prepared.prepared.language,
    cta: prepared.prepared.spec.storyStructure?.cta ?? "",
    storyboard: prepared.prepared.storyboard,
    costEstimate: prepared.prepared.costEstimate,
  });
}
