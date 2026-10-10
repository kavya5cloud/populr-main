import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { jobEngine } from "@/lib/jobs/shared";
import { JOB_TYPES, type JobInput, type JobPriority, type JobType } from "@/lib/jobs/types";

export const runtime = "nodejs";

// Create a Job (POST) or list jobs (GET). Every AI request enters here — nothing calls a
// provider directly. The job runs asynchronously in the background; poll /api/jobs/{id}
// (or subscribe to /api/jobs/{id}/events) for real progress.
export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 40 : 12, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const type = String(body.type || "");
  if (!(JOB_TYPES as readonly string[]).includes(type)) {
    return NextResponse.json({ error: "invalid_job_type", hint: JOB_TYPES.join(", ") }, { status: 422 });
  }
  const priority = (["high", "normal", "low"].includes(String(body.priority)) ? body.priority : "normal") as JobPriority;
  const key = await workspaceKey((body.wsid as string) ?? null);
  // A job with no owner could never be read back by anyone, so don't make one.
  if (!key) return NextResponse.json({ error: "no_key" }, { status: 400 });
  const input: JobInput = {
    requestType: body.requestType as string | undefined,
    workspaceKey: key ?? undefined,
    brief: (body.brief as Record<string, unknown>) ?? undefined,
    assetKind: body.assetKind as string | undefined,
    campaignId: (body.campaignId as string) ?? null,
    missionId: (body.missionId as string) ?? null,
    publish: !!body.publish,
    payload: (body.payload as Record<string, unknown>) ?? undefined,
  };

  const engine = jobEngine();
  const job = engine.createJob(type as JobType, input, { priority, idempotencyKey: body.idempotencyKey as string | undefined });
  // Run in the background; the response returns immediately for polling / SSE.
  void engine.drain();
  console.info(JSON.stringify({ event: "job_created", jobId: job.id, type, priority }));
  return NextResponse.json({ ok: true, job });
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 60 : 20, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  return NextResponse.json({ ok: true, jobs: jobEngine().listJobs().slice(0, 100) });
}
