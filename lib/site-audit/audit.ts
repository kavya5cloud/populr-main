// Populr's audit of its own site — every page in the sitemap, the way a search engine reads it.
//
// A site that sells SEO has to be the example. The free check looks at one page; this looks
// at all of them and at how they fit together: every page reachable, self-canonical,
// indexable, uniquely titled and described, with a working share image, valid structured
// data and links that don't break. scripts/site-audit.ts runs it against the live site every
// day and after every deploy, so the example can't quietly stop being one.
//
// Pure functions over fetched HTML — no network here — and only relative imports, so the
// same file runs under Next, Vitest and plain Node.

import { approxWidth, TITLE } from "../tools/serp.ts";

export type Level = "error" | "warning";
export type Issue = { level: Level; url: string; check: string; detail: string };

export type PageFacts = {
  url: string;
  lang: string | null;
  title: string | null;
  description: string | null;
  canonical: string | null;
  robots: string | null;
  h1Count: number;
  viewport: boolean;
  og: { title: string | null; description: string | null; image: string | null };
  twitterCard: string | null;
  jsonld: { ok: boolean; types: string[] }[];
  imagesWithoutAlt: number;
  /** Same-site links on the page, absolute, without #fragments. */
  links: string[];
  hreflang: { lang: string; href: string }[];
};

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) out[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? "";
  return out;
}
const tags = (html: string, name: string) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((m) => attrs(m[0]));

export function readPageFacts(html: string, url: string): PageFacts {
  const page = new URL(url);
  const metas = tags(html, "meta");
  const meta = (key: string) => {
    const t = metas.find((m) => (m.name ?? m.property ?? "").toLowerCase() === key);
    return t?.content !== undefined ? decode(t.content) : null;
  };
  const links = tags(html, "link");
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];

  const jsonld: PageFacts["jsonld"] = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if ((attrs(m[1]).type ?? "").toLowerCase() !== "application/ld+json") continue;
    try {
      const data = JSON.parse(m[2]);
      const items = (Array.isArray(data) ? data : [data]).flatMap((d) => [d, ...(Array.isArray(d?.["@graph"]) ? d["@graph"] : [])]);
      jsonld.push({ ok: true, types: items.flatMap((i) => [i?.["@type"]].flat()).filter((t): t is string => typeof t === "string") });
    } catch {
      jsonld.push({ ok: false, types: [] });
    }
  }

  const sameSite: string[] = [];
  for (const a of tags(html, "a")) {
    if (!a.href || /^(mailto:|tel:|javascript:|#)/i.test(a.href)) continue;
    try {
      const u = new URL(decode(a.href), url);
      if (u.hostname !== page.hostname || !/^https?:$/.test(u.protocol)) continue;
      u.hash = "";
      sameSite.push(u.toString());
    } catch { /* not a URL */ }
  }

  return {
    url,
    lang: tags(html, "html")[0]?.lang || null,
    title: title !== undefined ? decode(title.replace(/<[^>]+>/g, "")) : null,
    description: meta("description"),
    canonical: links.find((l) => (l.rel ?? "").toLowerCase().split(/\s+/).includes("canonical"))?.href ?? null,
    robots: meta("robots"),
    h1Count: (html.match(/<h1\b/gi) ?? []).length,
    viewport: meta("viewport") !== null,
    og: { title: meta("og:title"), description: meta("og:description"), image: meta("og:image") },
    twitterCard: meta("twitter:card"),
    jsonld,
    imagesWithoutAlt: tags(html, "img").filter((i) => i.alt === undefined).length,
    links: [...new Set(sameSite)],
    hreflang: links.filter((l) => (l.rel ?? "").toLowerCase() === "alternate" && l.hreflang && l.href).map((l) => ({ lang: l.hreflang.toLowerCase(), href: new URL(l.href, url).toString() })),
  };
}

/** The same URL, give or take a trailing slash on the bare origin. */
const same = (a: string, b: string) => a.replace(/\/$/, "") === b.replace(/\/$/, "");

/** What's wrong with one page, judged on its own. */
export function pageIssues(f: PageFacts): Issue[] {
  const out: Issue[] = [];
  const add = (level: Level, check: string, detail: string) => out.push({ level, url: f.url, check, detail });

  if (!f.lang) add("error", "lang", "<html> has no lang attribute — search engines and screen readers have to guess the language.");
  if (!f.viewport) add("error", "viewport", "No viewport meta tag — the page isn't mobile-friendly to Google.");
  if (!f.title) add("error", "title", "No <title>.");
  else if (approxWidth(f.title, TITLE.sizePx) > TITLE.maxPx) add("warning", "title", `"${f.title}" is about ${Math.round(approxWidth(f.title, TITLE.sizePx))}px wide — Google cuts at about ${TITLE.maxPx}px.`);
  if (!f.description) add("error", "description", "No meta description.");
  else if (f.description.length < 70 || f.description.length > 160) add("warning", "description", `${f.description.length} characters — aim for 70–160.`);
  if (!f.canonical) add("error", "canonical", "No canonical link.");
  else if (!/^https:\/\//.test(f.canonical)) add("error", "canonical", `Canonical "${f.canonical}" isn't an absolute https URL.`);
  else if (!same(f.canonical, f.url)) add("error", "canonical", `Canonical points to ${f.canonical}, not to this page — a sitemap page should be its own canonical.`);
  if (f.robots && /noindex/i.test(f.robots)) add("error", "robots", `Marked "${f.robots}" but listed in the sitemap.`);
  if (f.h1Count === 0) add("error", "h1", "No <h1>.");
  else if (f.h1Count > 1) add("warning", "h1", `${f.h1Count} <h1> elements — one says clearly what the page is.`);
  if (!f.og.title || !f.og.description || !f.og.image) add("warning", "open-graph", `Missing ${[!f.og.title && "og:title", !f.og.description && "og:description", !f.og.image && "og:image"].filter(Boolean).join(", ")} — link previews will be bare.`);
  if (!f.twitterCard) add("warning", "twitter-card", "No twitter:card — X shows a plain link.");
  if (!f.jsonld.length) add("warning", "structured-data", "No JSON-LD structured data.");
  if (f.jsonld.some((j) => !j.ok)) add("error", "structured-data", "A JSON-LD block doesn't parse — search engines ignore all of it.");
  if (f.imagesWithoutAlt) add("warning", "img-alt", `${f.imagesWithoutAlt} <img> without an alt attribute (use alt="" for decorative images).`);
  if (f.hreflang.length && !f.hreflang.some((h) => h.lang === "x-default")) add("warning", "hreflang", "Language alternates without an x-default.");
  return out;
}

/** What's wrong across pages: duplicates, and language alternates that don't point back. */
export function siteIssues(pages: PageFacts[]): Issue[] {
  const out: Issue[] = [];
  for (const key of ["title", "description"] as const) {
    const by = new Map<string, string[]>();
    for (const p of pages) if (p[key]) by.set(p[key]!, [...(by.get(p[key]!) ?? []), p.url]);
    for (const [value, urls] of by) {
      if (urls.length > 1) for (const url of urls) out.push({ level: "error", url, check: `duplicate-${key}`, detail: `Same ${key} as ${urls.filter((u) => u !== url).join(", ")}: "${value}"` });
    }
  }
  const byUrl = new Map(pages.map((p) => [p.url.replace(/\/$/, ""), p]));
  for (const p of pages) {
    for (const alt of p.hreflang) {
      const target = byUrl.get(alt.href.replace(/\/$/, ""));
      if (!target || same(alt.href, p.url)) continue;
      if (!target.hreflang.some((h) => same(h.href, p.url))) {
        out.push({ level: "error", url: p.url, check: "hreflang", detail: `Lists ${alt.href} as its ${alt.lang} version, but that page doesn't link back.` });
      }
    }
  }
  return out;
}

export function sitemapUrls(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decode(m[1]));
}
