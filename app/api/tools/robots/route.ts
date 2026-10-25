import { NextRequest, NextResponse } from "next/server";
import { siteFrom } from "@/lib/check/checks";
import { safeFetchText } from "@/lib/net/safe-fetch";
import { rateLimit, requestKey } from "@/lib/throttle";
import { reportFor, type RobotsReport } from "@/lib/tools/robots";

export const runtime = "nodejs";
export const maxDuration = 15;

// GET /api/tools/robots?url=example.com&path=/menu — the AI crawler checker.
//
// Public, so: one fetch of one public file through the SSRF guard, a few checks per visitor
// per ten minutes, and a site checked in the last ten minutes answered from memory.

const FRESH_MS = 10 * 60_000;
const NO_STORE = { "Cache-Control": "no-store" };

type Cached = { at: number; fetched: { status: number; text: string } | null; origin: string };
const g = globalThis as unknown as { __populrRobotsCache?: Map<string, Cached> };
const cache = (g.__populrRobotsCache ??= new Map());

export async function GET(req: NextRequest) {
  const site = siteFrom((req.nextUrl.searchParams.get("url") ?? "").slice(0, 300));
  if (!site) return NextResponse.json({ error: "bad_url", message: "Enter a website address, like example.com." }, { status: 400, headers: NO_STORE });
  let path = (req.nextUrl.searchParams.get("path") ?? "/").trim().slice(0, 300) || "/";
  if (!path.startsWith("/")) path = `/${path}`;

  let hit = cache.get(site.domain);
  if (!hit || Date.now() - hit.at > FRESH_MS) {
    const limit = rateLimit(`tools-robots:${requestKey(req.headers)}`, 20, 10 * 60_000);
    if (!limit.allowed) {
      return NextResponse.json({ error: "rate_limited", message: `You've run a lot of checks — try again in ${Math.ceil(limit.retryAfter / 60)} min.` }, { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfter) } });
    }
    let fetched: Cached["fetched"] = null;
    let origin = site.url.replace(/\/$/, "");
    try {
      const r = await safeFetchText(`${site.url}robots.txt`, { timeoutMs: 8_000, maxBytes: 500_000, headers: { "User-Agent": "PopulrTools/1.0 (+https://www.trypopulr.in/tools/ai-crawler-checker)" } });
      fetched = { status: r.status, text: r.text };
      origin = new URL(r.url).origin;
    } catch {
      // No answer at all: crawlers treat the whole site as off limits, and so does the report.
    }
    hit = { at: Date.now(), fetched, origin };
    cache.set(site.domain, hit);
    if (cache.size > 2_000) cache.delete(cache.keys().next().value!);
  }

  const report: RobotsReport = reportFor(hit.origin, hit.fetched, path);
  return NextResponse.json({ ok: true, domain: site.domain, report, robotsTxt: hit.fetched && hit.fetched.status < 400 ? hit.fetched.text.slice(0, 20_000) : null }, { headers: NO_STORE });
}
