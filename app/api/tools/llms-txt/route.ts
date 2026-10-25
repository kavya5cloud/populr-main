import { NextRequest, NextResponse } from "next/server";
import { siteFrom } from "@/lib/check/checks";
import { rateLimit, requestKey } from "@/lib/throttle";
import { generateLlmsTxt, LlmsFetchError } from "@/lib/tools/llms-txt";

export const runtime = "nodejs";
export const maxDuration = 30;

// POST /api/tools/llms-txt { url } — the llms.txt generator.
//
// Reads up to twenty pages of someone's site, so it's held tighter than the other tools: a
// handful of runs per visitor per ten minutes, and a site generated in the last half hour is
// answered from memory — a shared link must not turn into Populr crawling someone's site
// over and over. Every fetch goes through the SSRF guard.

const FRESH_MS = 30 * 60_000;
const NO_STORE = { "Cache-Control": "no-store" };

type Done = { at: number; origin: string; content: string; pages: number; source: "sitemap" | "links" };
const g = globalThis as unknown as { __populrLlmsCache?: Map<string, Done> };
const cache = (g.__populrLlmsCache ??= new Map());

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { url?: unknown };
  const site = siteFrom(typeof body.url === "string" ? body.url.slice(0, 300) : "");
  if (!site) return NextResponse.json({ error: "bad_url", message: "Enter a website address, like example.com." }, { status: 400, headers: NO_STORE });

  const hit = cache.get(site.domain);
  if (hit && Date.now() - hit.at < FRESH_MS) return NextResponse.json({ ok: true, cached: true, ...hit }, { headers: NO_STORE });

  const limit = rateLimit(`tools-llms:${requestKey(req.headers)}`, 6, 10 * 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited", message: `You've generated a lot of files — try again in ${Math.ceil(limit.retryAfter / 60)} min.` }, { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfter) } });
  }

  try {
    const r = await generateLlmsTxt(site.url, { budgetMs: 18_000 });
    const done: Done = { at: Date.now(), ...r };
    cache.set(site.domain, done);
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return NextResponse.json({ ok: true, cached: false, ...done }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof LlmsFetchError) return NextResponse.json({ error: "unreachable", message: e.message }, { status: 422, headers: NO_STORE });
    return NextResponse.json({ error: "failed", message: "Generating failed on our side. Try again in a moment." }, { status: 502, headers: NO_STORE });
  }
}
