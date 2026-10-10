import { NextRequest } from "next/server";
import { rateLimit, requestKey } from "@/lib/throttle";
import { autopilotStore } from "@/lib/seo/autopilot-store";

export const runtime = "nodejs";

// GET /api/seo/autopilot/seen?k=&p= — the snippet saying "I'm running on this page".
//
// Public by necessity: it is called from the customer's visitors' browsers. So it records
// almost nothing — that the key was seen, on which path — and never anything about the
// visitor. Rate limited per caller so it can't be used to pump the counters.

const NO_CONTENT = new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

export async function GET(req: NextRequest) {
  const limit = rateLimit(`autopilot-seen:${requestKey(req.headers)}`, 30, 60_000);
  if (!limit.allowed) return NO_CONTENT;
  const k = req.nextUrl.searchParams.get("k") ?? "";
  const p = (req.nextUrl.searchParams.get("p") ?? "/").slice(0, 200);
  if (/^[A-Za-z0-9_-]{6,40}$/.test(k)) await autopilotStore().seen(k, p, Date.now()).catch(() => {});
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
