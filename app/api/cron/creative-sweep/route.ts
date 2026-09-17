import { NextRequest, NextResponse } from "next/server";
import { creativeContext } from "@/lib/creative/shared";
import { sweep } from "@/lib/creative/lifecycle";
import { seedanceConfigured } from "@/lib/creative/providers/seedance";

export const runtime = "nodejs";
export const maxDuration = 60;

// The backstop.
//
// The webhook is the primary path; this exists because a webhook that is never delivered
// would otherwise leave a paid generation stuck in "running" forever. It finds non-terminal
// jobs that have not moved recently and asks the provider what happened.
//
// Deliberately a separate route from the publishing cron. They share a schedule host but
// nothing else: a failure in creative sweeping must not be able to stop posts going out,
// and the publish pass has its own timeout budget that this should not eat into.
//
// Bounded by design — a fixed batch per run, and jobs past the provider's 7-day task
// retention are failed rather than polled forever (see sweep()).
function authCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (req.headers.get("x-vercel-cron")) return true;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!seedanceConfigured()) return NextResponse.json({ ok: true, skipped: "not_configured" });

  try {
    const result = await sweep(creativeContext(), { staleMs: 60_000, limit: 20 });
    console.info(JSON.stringify({ event: "creative_sweep", ...result }));
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: "sweep_failed", detail: String(e).slice(0, 200) }, { status: 503 });
  }
}
