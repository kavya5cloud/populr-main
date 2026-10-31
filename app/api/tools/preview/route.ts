import { NextRequest, NextResponse } from "next/server";
import { siteFrom } from "@/lib/check/checks";
import { rateLimit, requestKey } from "@/lib/throttle";
import { checkLinkPreview, PreviewFetchError } from "@/lib/tools/link-preview";

export const runtime = "nodejs";
export const maxDuration = 20;

// GET /api/tools/preview?url=https://example.com/page — the link preview checker.
//
// Public, so: the page and its share image only, fetched through the SSRF guard (the image
// only as far as its header), a few checks per visitor per ten minutes, and a page checked
// in the last ten minutes answered from memory.

const FRESH_MS = 10 * 60_000;
const NO_STORE = { "Cache-Control": "no-store" };
type Done = { at: number; result: Awaited<ReturnType<typeof checkLinkPreview>> };
const g = globalThis as unknown as { __populrPreviewCache?: Map<string, Done> };
const cache = (g.__populrPreviewCache ??= new Map());

export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get("url") ?? "").trim().slice(0, 1000);
  const site = siteFrom(raw);
  if (!site) return NextResponse.json({ error: "bad_url", message: "Enter a page address, like example.com/about." }, { status: 400, headers: NO_STORE });
  let pageUrl: string;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    u.hash = "";
    pageUrl = u.toString();
  } catch {
    return NextResponse.json({ error: "bad_url", message: "Enter a page address, like example.com/about." }, { status: 400, headers: NO_STORE });
  }

  const hit = cache.get(pageUrl);
  if (hit && Date.now() - hit.at < FRESH_MS) return NextResponse.json({ ok: true, cached: true, ...hit.result }, { headers: NO_STORE });

  const limit = rateLimit(`tools-preview:${requestKey(req.headers)}`, 20, 10 * 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited", message: `You've run a lot of checks — try again in ${Math.ceil(limit.retryAfter / 60)} min.` }, { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfter) } });
  }
  try {
    const result = await checkLinkPreview(pageUrl);
    cache.set(pageUrl, { at: Date.now(), result });
    if (cache.size > 2_000) cache.delete(cache.keys().next().value!);
    return NextResponse.json({ ok: true, cached: false, ...result }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof PreviewFetchError) return NextResponse.json({ error: "unreachable", message: e.message }, { status: 422, headers: NO_STORE });
    return NextResponse.json({ error: "failed", message: "The check failed on our side. Try again in a moment." }, { status: 502, headers: NO_STORE });
  }
}
