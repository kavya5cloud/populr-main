import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { creativeJobs } from "@/lib/creative/shared";
import { isReady } from "@/lib/creative/jobs";

export const runtime = "nodejs";

// Status for one creative job.
//
// The response is deliberately small: the internal state, the asset id once there is one,
// and an error string. No provider name, no task id, no provider URL, no credentials, no
// storage key. A client that knows the task id could not do anything with it, but there is
// no reason to publish our provider relationship to a browser.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  // Polled by the UI while a video renders, so the ceiling is higher than the generate route.
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 240 : 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }

  const { id } = await ctx.params;
  const key = await workspaceKey(req.nextUrl.searchParams.get("wsid"));
  if (!key) return NextResponse.json({ error: "no_key" }, { status: 400 });

  const job = await creativeJobs().get(id, key);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({
    ok: true,
    id: job.id,
    status: job.status,
    // Only present when a stored, validated asset exists — isReady() requires the asset id,
    // so a client cannot be handed something to play before there is something to play.
    assetId: isReady(job) ? job.assetId : null,
    error: job.error,
    costEstimate: job.costEstimate,
    updatedAt: job.updatedAt,
  });
}
