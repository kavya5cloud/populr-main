import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { jobEngine } from "@/lib/jobs/shared";
import { callerWorkspace, ownsJob } from "@/lib/jobs/access";

export const runtime = "nodejs";

// Execution Dashboard payload — queue metrics, worker health, provider usage, system load
// and the most recent jobs. One call for the cockpit.
export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 60 : 20, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  const ws = await callerWorkspace(req);
  if (!ws) return NextResponse.json({ error: "no_key" }, { status: 400 });
  const engine = jobEngine();
  // This workspace's jobs only. It listed every business's jobs — ids included, which then
  // opened each one through /api/jobs/{id}.
  const mine = engine.listJobs().filter((j) => ownsJob(j, ws));
  const count = (state: string) => mine.filter((j) => j.state === state).length;
  const done = mine.filter((j) => j.state === "completed");
  const global = engine.metrics();
  const mineIds = new Set(mine.map((j) => j.id));
  return NextResponse.json({
    ok: true,
    // Same shape the page reads. Job counts and averages are this workspace's own; the
    // infrastructure numbers (concurrency, load, worker health) belong to no business and
    // stay, except that a worker busy on someone else's job doesn't say which.
    metrics: {
      ...global,
      queued: count("queued") + count("waiting_for_resources"),
      running: mine.filter((j) => !["queued", "waiting_for_resources", "paused", "completed", "failed", "timed_out", "cancelled", "dead_letter"].includes(j.state)).length,
      completed: done.length,
      failed: count("failed") + count("timed_out"),
      retrying: count("retrying"),
      deadLetter: count("dead_letter"),
      avgDurationMs: done.length ? Math.round(done.reduce((n, j) => n + ((j.completedAt ?? 0) - (j.startedAt ?? 0)), 0) / done.length) : 0,
      avgCost: done.length ? Math.round((done.reduce((n, j) => n + j.cost, 0) / done.length) * 100) / 100 : 0,
      workers: global.workers.map((w) => ({ ...w, currentJobId: w.currentJobId && mineIds.has(w.currentJobId) ? w.currentJobId : null })),
      providerUsage: {},
    },
    jobs: mine.slice(0, 40).map((j) => ({
      id: j.id, type: j.type, state: j.state, progress: j.progress, priority: j.priority,
      cost: j.cost, attempts: j.attempts, createdAt: j.createdAt,
      durationMs: j.startedAt ? (j.completedAt ?? j.updatedAt) - j.startedAt : null,
    })),
  });
}
