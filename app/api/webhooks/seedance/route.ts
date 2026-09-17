import { NextRequest, NextResponse } from "next/server";
import { creativeContext, creativeJobs } from "@/lib/creative/shared";
import { advance } from "@/lib/creative/lifecycle";

export const runtime = "nodejs";
export const maxDuration = 60;

// The Seedance callback.
//
// Two things about this endpoint are worth stating plainly, because both are security
// decisions rather than implementation details.
//
// 1. The provider does not cryptographically sign its callbacks. The documented mechanism
//    is a plain `callback_url`, with no signature header and no shared-secret scheme. So
//    the strongest verification available is a secret embedded in the URL we registered
//    (see seedanceCallbackUrl), which proves only that the caller has seen that URL. That
//    is a real limitation and it is documented in docs/creative-engine.md rather than
//    dressed up.
//
// 2. Because of (1), **nothing in the request body is trusted**. The body is used for
//    exactly one thing: to find out which task the caller is talking about. The status,
//    the video URL and every other field are discarded, and the pipeline re-queries the
//    provider over an authenticated connection to learn what actually happened. A forged
//    callback can therefore cause an unnecessary poll, and nothing else. It cannot mark a
//    job ready, cannot attach an asset, and cannot supply a URL for us to download.

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = req.nextUrl.searchParams.get("k");
  if (!provided || provided.length !== secret.length) return false;
  // Constant-time-ish compare: length is checked first, then every byte is examined.
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= secret.charCodeAt(i) ^ provided.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  // The only field read from the payload.
  const taskId = typeof body.id === "string" ? body.id : "";
  if (!taskId || !/^[A-Za-z0-9._-]{1,128}$/.test(taskId)) {
    return NextResponse.json({ error: "bad_task_id" }, { status: 400 });
  }

  // Find the job that owns this task. The workspace comes from our own record, never from
  // the request — this is what makes it impossible for a callback to attach an asset to
  // someone else's job.
  const job = await creativeJobs().findByTask(taskId);
  if (!job) {
    // 200, not 404: an unknown task is not something the provider can fix by retrying, and
    // a 404 would let a caller probe which task ids exist.
    return NextResponse.json({ ok: true, known: false });
  }
  if (job.provider !== "seedance-video") {
    return NextResponse.json({ ok: true, known: false });
  }

  const updated = await advance(creativeContext(), job);
  console.info(JSON.stringify({ event: "creative_webhook", jobId: updated.id, status: updated.status }));
  return NextResponse.json({ ok: true, known: true, status: updated.status });
}
