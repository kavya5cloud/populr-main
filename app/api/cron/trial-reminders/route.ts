import { NextRequest, NextResponse } from "next/server";
import { sendTrialNotices } from "@/lib/billing/notices";
import { usageRepo } from "@/lib/billing/usage-store";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET /api/cron/trial-reminders — once a day, from .github/workflows/trial-reminders.yml.
//
// Vercel's two daily crons are both spent, so this runs from GitHub Actions like publishing
// does. Only counts come back: the emails and who they went to stay out of the logs.

function authCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (req.headers.get("x-vercel-cron")) return true;
  if (!secret) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

/** Past this, a usage row can't affect any limit, so hashed addresses aren't kept any longer. */
const KEEP_USAGE_MS = 62 * 86_400_000;

export async function GET(req: NextRequest) {
  if (!authCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const now = Date.now();
  const run = await sendTrialNotices(now);
  await usageRepo().prune(now - KEEP_USAGE_MS).catch(() => undefined);
  return NextResponse.json({ ok: true, ...run });
}
