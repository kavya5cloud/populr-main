import { NextRequest, NextResponse } from "next/server";
import { rateLimit, requestKey } from "@/lib/throttle";
import { DOMAIN_RE, siteFrom } from "@/lib/check/checks";
import { checkSite, CheckFetchError } from "@/lib/check/run";
import { checkStore } from "@/lib/check/store";

export const runtime = "nodejs";
export const maxDuration = 30;

// POST /api/check { url } — run the free SEO & AI-readiness check on a public website.
// GET  /api/check?domain=example.com — the latest result.
//
// Public and unauthenticated, so: the fetches go through the SSRF guard, each visitor gets
// a handful of checks per ten minutes, and a domain checked in the last half hour reuses that
// result — a link going viral doesn't turn into Populr hammering someone's site.

const FRESH_MS = 30 * 60_000;
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { url?: unknown };
  const site = siteFrom(typeof body.url === "string" ? body.url.slice(0, 300) : "");
  if (!site) return NextResponse.json({ error: "bad_url", message: "Enter a website address, like example.com." }, { status: 400, headers: NO_STORE });

  const store = checkStore();
  const cached = await store.get(site.domain).catch(() => null);
  if (cached && Date.now() - cached.checkedAt < FRESH_MS) return NextResponse.json({ ok: true, cached: true, result: cached }, { headers: NO_STORE });

  const limit = rateLimit(`check:${requestKey(req.headers)}`, 10, 10 * 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited", message: `You've run a lot of checks — try again in ${Math.ceil(limit.retryAfter / 60)} min.` }, { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfter) } });
  }

  try {
    const result = await checkSite(site);
    await store.save(result).catch(() => undefined);
    return NextResponse.json({ ok: true, cached: false, result }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof CheckFetchError) return NextResponse.json({ error: "unreachable", message: e.message }, { status: 422, headers: NO_STORE });
    return NextResponse.json({ error: "failed", message: "The check failed on our side. Try again in a moment." }, { status: 502, headers: NO_STORE });
  }
}

export async function GET(req: NextRequest) {
  const domain = (req.nextUrl.searchParams.get("domain") ?? "").toLowerCase();
  if (!DOMAIN_RE.test(domain)) return NextResponse.json({ error: "bad_domain" }, { status: 400 });
  const result = await checkStore().get(domain).catch(() => null);
  if (!result) return NextResponse.json({ error: "not_checked" }, { status: 404 });
  return NextResponse.json({ ok: true, result }, { headers: { "Cache-Control": "public, max-age=60" } });
}
