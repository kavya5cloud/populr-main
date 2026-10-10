import { NextRequest, NextResponse } from "next/server";
import { jobEngine } from "@/lib/jobs/shared";
import { callerWorkspace, ownsJob } from "@/lib/jobs/access";

export const runtime = "nodejs";

// resume a job, then continue execution in the background.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const engine = jobEngine();
  // Someone else's job and a job that doesn't exist look the same from outside: 404.
  if (!ownsJob(engine.getJob(id), await callerWorkspace(req))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const ok = engine.resume(id);
  if (ok) void engine.drain();
  return NextResponse.json({ ok, job: engine.getJob(id) }, { status: ok ? 200 : 409 });
}
