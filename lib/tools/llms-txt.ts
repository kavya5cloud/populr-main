import { readHtml } from "@/lib/check/checks";
import { safeFetchText } from "@/lib/net/safe-fetch";

// The free llms.txt generator: a site's own map of itself, for AI assistants.
//
// Built from what the site already publishes — its sitemap (or, without one, the links on
// its home page) and each page's own title and meta description. Nothing is written by a
// model: an llms.txt that describes pages in words the pages don't use would be telling
// assistants something the site never said. The result follows llmstxt.org — an H1 with
// the site's name, a one-line summary as a blockquote, then H2 sections of links.

export type PageInfo = { url: string; title: string | null; description: string | null };

const UA = { "User-Agent": "PopulrTools/1.0 (+https://www.trypopulr.in/tools/llms-txt-generator)" };

/** <loc> entries of a sitemap, and whether it's an index of other sitemaps. */
export function readSitemap(xml: string): { urls: string[]; isIndex: boolean } {
  const urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
  return { urls, isIndex: /<sitemapindex\b/i.test(xml) };
}

/** Same-site links on a page, for sites without a sitemap. */
export function linksOn(html: string, origin: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    try { out.push(new URL((m[1] ?? m[2] ?? "").replace(/&amp;/g, "&"), origin + "/").toString()); } catch { /* not a URL */ }
  }
  return out;
}

// Archive, feed and pagination URLs repeat other pages; assets aren't pages at all.
const SKIP = /\/(tag|tags|category|categories|author|page\/\d+|feed|wp-json|wp-content|cdn-cgi|cart|checkout|account|login|signin|signup|search)(\/|$)|\.(xml|jpe?g|png|gif|webp|svg|pdf|zip|css|js|json|txt|ico|mp4)$/i;

/** The pages worth listing: this site only, no duplicates, shallow pages first. */
export function pickPages(origin: string, urls: string[], max = 20): string[] {
  const host = new URL(origin).hostname.replace(/^www\./, "");
  const seen = new Set<string>();
  const picked: { url: string; depth: number; i: number }[] = [];
  urls.forEach((raw, i) => {
    let u: URL;
    try { u = new URL(raw); } catch { return; }
    if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, "") !== host) return;
    if (u.search || SKIP.test(u.pathname)) return;
    const path = u.pathname.replace(/\/+$/, "") || "/";
    if (path === "/" || seen.has(path)) return;
    seen.add(path);
    picked.push({ url: origin + path, depth: path.split("/").length, i });
  });
  return picked.sort((a, b) => a.depth - b.depth || a.i - b.i).slice(0, max).map((p) => p.url);
}

const SEPARATORS = /\s+[|–—·•:-]\s+/;
const GENERIC = /^(home|homepage|home page|welcome|official site|official website)$/i;

/** The site's name: what it calls itself in og:site_name, or the brand part of its home title. */
export function siteNameFrom(html: string, origin: string): string {
  const tag = html.slice(0, 400_000).match(/<meta\b[^>]*property\s*=\s*["']?og:site_name["']?[^>]*>/i)?.[0];
  // A name like "Rao's Bakery" has an apostrophe inside double quotes: match the quote it opened with.
  const m = tag?.match(/content\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
  const og = (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").replace(/&amp;/g, "&").replace(/&#0?39;|&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').trim();
  if (og) return og;
  const parts = (readHtml(html).title ?? "").split(SEPARATORS).map((p) => p.trim()).filter((p) => p && !GENERIC.test(p));
  if (parts.length) return parts.reduce((a, b) => (b.length < a.length ? b : a));
  return new URL(origin).hostname.replace(/^www\./, "");
}

/** A page's title without the " | Brand" every page repeats. */
export function cleanTitle(title: string | null, brand: string): string | null {
  if (!title) return null;
  const parts = title.split(SEPARATORS).map((p) => p.trim()).filter(Boolean);
  const kept = parts.filter((p) => p.toLowerCase() !== brand.toLowerCase());
  return (kept.length ? kept.join(" — ") : title).trim() || null;
}

const sectionName = (segment: string) => {
  const words = decodeURIComponent(segment).replace(/[-_]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Pages";
};

export function buildLlmsTxt(site: { name: string; summary: string | null }, pages: PageInfo[]): string {
  const lines = [`# ${site.name}`, ""];
  if (site.summary) lines.push(`> ${site.summary}`, "");

  // A section per top-level folder with more than one page (Blog, Products…); the rest
  // are the site's main pages.
  const bySegment = new Map<string, PageInfo[]>();
  for (const p of pages) {
    const seg = new URL(p.url).pathname.split("/").filter(Boolean);
    const key = seg.length > 1 ? seg[0] : "";
    bySegment.set(key, [...(bySegment.get(key) ?? []), p]);
  }
  const main = [...(bySegment.get("") ?? [])];
  const sections: [string, PageInfo[]][] = [];
  for (const [seg, list] of bySegment) {
    if (!seg) continue;
    if (list.length > 1) sections.push([sectionName(seg), list]);
    else main.push(...list);
  }
  const entry = (p: PageInfo) => {
    const label = cleanTitle(p.title, site.name) ?? (decodeURIComponent(new URL(p.url).pathname.split("/").filter(Boolean).pop() ?? "").replace(/[-_]+/g, " ") || p.url);
    return `- [${label.replace(/[[\]]/g, "")}](${p.url})${p.description ? `: ${p.description}` : ""}`;
  };
  if (main.length) lines.push("## Pages", "", ...main.map(entry), "");
  for (const [name, list] of sections.sort((a, b) => b[1].length - a[1].length)) lines.push(`## ${name}`, "", ...list.map(entry), "");
  return lines.join("\n").trimEnd() + "\n";
}

type Fetch = typeof safeFetchText;

async function text(fetch: Fetch, url: string, timeoutMs: number, maxBytes: number): Promise<{ url: string; text: string } | null> {
  try {
    const r = await fetch(url, { timeoutMs, maxBytes, headers: UA });
    return r.status === 200 && r.text ? { url: r.url, text: r.text } : null;
  } catch {
    return null;
  }
}

export class LlmsFetchError extends Error {}

/** Everything the generator needs from a live site, fetched through the SSRF-guarded fetcher. */
export async function generateLlmsTxt(siteUrl: string, opts: { fetch?: Fetch; maxPages?: number; budgetMs?: number } = {}): Promise<{ origin: string; content: string; pages: number; source: "sitemap" | "links" }> {
  const fetch = opts.fetch ?? safeFetchText;
  const deadline = Date.now() + (opts.budgetMs ?? 20_000);
  const home = await text(fetch, siteUrl, 12_000, 3_000_000);
  if (!home) throw new LlmsFetchError("Couldn't load that site's home page. Check the address — it has to be a public website.");
  const origin = new URL(home.url).origin;

  // Sitemaps: the ones robots.txt names on this site, else /sitemap.xml. An index is
  // followed one level, to its first few sitemaps.
  const robots = await text(fetch, `${origin}/robots.txt`, 5_000, 200_000);
  const host = new URL(origin).hostname.replace(/^www\./, "");
  const named = [...(robots?.text ?? "").matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1])
    .filter((u) => { try { return new URL(u).hostname.replace(/^www\./, "") === host; } catch { return false; } });
  let urls: string[] = [];
  for (const sm of (named.length ? named : [`${origin}/sitemap.xml`]).slice(0, 2)) {
    const got = await text(fetch, sm, 6_000, 3_000_000);
    if (!got) continue;
    const { urls: locs, isIndex } = readSitemap(got.text);
    if (!isIndex) { urls.push(...locs); continue; }
    for (const child of locs.slice(0, 3)) {
      const c = await text(fetch, child, 6_000, 3_000_000);
      if (c) urls.push(...readSitemap(c.text).urls);
    }
  }
  const source = urls.length ? "sitemap" : "links";
  if (!urls.length) urls = linksOn(home.text, origin);

  const chosen = pickPages(origin, urls, opts.maxPages ?? 20);
  const pages: PageInfo[] = [];
  // Five at a time, inside the time budget. A page that doesn't answer in time is still
  // listed — by its address — rather than holding up the rest.
  for (let i = 0; i < chosen.length; i += 5) {
    const batch = chosen.slice(i, i + 5);
    if (Date.now() > deadline) { pages.push(...batch.map((url) => ({ url, title: null, description: null }))); continue; }
    const read = await Promise.all(batch.map(async (url) => {
      const got = await text(fetch, url, 5_000, 1_500_000);
      const h = got ? readHtml(got.text) : null;
      return { url, title: h?.title ?? null, description: h?.description ?? null };
    }));
    pages.push(...read);
  }

  const homeHtml = readHtml(home.text);
  const content = buildLlmsTxt({ name: siteNameFrom(home.text, origin), summary: homeHtml.description }, pages);
  return { origin, content, pages: pages.length, source };
}
