import { NextRequest, NextResponse } from "next/server";
import { jobEngine } from "@/lib/jobs/shared";
import { callerWorkspace, ownsJob } from "@/lib/jobs/access";

export const runtime = "nodejs";

// Job snapshot + live progress (state, percent, stage, ETA, queue position, cost, refs).
// This is the polling endpoint the AI Processing experience reads real progress from.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const engine = jobEngine();
  const job = engine.getJob(id);
  // Another business's job reads exactly like a missing one.
  if (!ownsJob(job, await callerWorkspace(req))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, job, progress: engine.progress(id) });
}
