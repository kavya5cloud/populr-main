import { NextRequest } from "next/server";
import { DOMAIN_RE } from "@/lib/check/checks";
import { checkStore } from "@/lib/check/store";

// /check/<domain>/badge.svg — "SEO & AI ready · 92 · Populr", for sites to show off.
// Each badge links back to its result page, so every site that displays one sends the next
// visitor to check their own.

export const runtime = "nodejs";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function GET(_req: NextRequest, { params }: { params: Promise<{ domain: string }> }) {
  const domain = decodeURIComponent((await params).domain).toLowerCase();
  const result = DOMAIN_RE.test(domain) ? await checkStore().get(domain).catch(() => null) : null;
  const value = result ? `${result.score}/100` : "not checked";
  const tone = !result ? "#9aa39c" : result.score >= 75 ? "#d5ff72" : result.score >= 50 ? "#ffd166" : "#ff8a6b";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="210" height="28" viewBox="0 0 210 28" role="img" aria-label="SEO and AI ready: ${esc(value)}, checked by Populr">
  <title>SEO &amp; AI ready: ${esc(value)} — checked by Populr</title>
  <rect width="210" height="28" rx="6" fill="#0d0f0d"/>
  <rect x="118" width="92" height="28" rx="6" fill="${tone}"/>
  <rect x="118" width="10" height="28" fill="${tone}"/>
  <g font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif" font-size="12" font-weight="600">
    <text x="12" y="18" fill="#fafafa">SEO &amp; AI ready</text>
    <text x="164" y="18" fill="#0d0f0d" text-anchor="middle">${esc(value)}</text>
  </g>
</svg>`;
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=3600, s-maxage=3600", "X-Content-Type-Options": "nosniff" } });
}
