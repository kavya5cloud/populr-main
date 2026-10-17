// The free SEO & AI-readiness check — what it measures and how it scores.
//
// Every check is read off something we fetched: the home page as served, robots.txt,
// /llms.txt and /sitemap.xml. Nothing is estimated. The score is simply the points for the
// checks the site passes, out of 100, and each check is shown with its points, so the number
// can always be explained. (This product argues against marketing tools that invent
// numbers; this one must not.)

export type CheckGroup = "search" | "ai";

export type Check = {
  id: string;
  group: CheckGroup;
  label: string;
  points: number;
  passed: boolean;
  /** What we found, in one line. */
  detail: string;
  /** What to do about it, when it failed. */
  fix: string;
};

export type Fetched = {
  /** The home page's final address, after redirects. */
  finalUrl: string;
  html: string;
  /** robots.txt, or null if there isn't one. */
  robots: string | null;
  /** Body of /llms.txt when it answered 200, else null. */
  llms: string | null;
  /** Body of /sitemap.xml when it answered 200, else null. */
  sitemap: string | null;
};

export type CheckResult = {
  domain: string;
  url: string;
  score: number;
  grade: "A" | "B" | "C" | "D" | "E";
  passed: number;
  total: number;
  checks: Check[];
  checkedAt: number;
};

export const AI_CRAWLERS = ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended"] as const;

// ── Reading the page ──────────────────────────────────────────────────────────────────

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

// Attribute values may be double-quoted, single-quoted or bare (lang=en, name=viewport):
// all valid HTML, and minified sites use the bare form.
function attrsOf(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const a of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? "";
  return attrs;
}

const tags = (html: string, name: string) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((m) => attrsOf(m[0]));

function metaTags(html: string): Record<string, string>[] {
  return tags(html, "meta");
}

function meta(html: string, key: string): string | null {
  const tag = metaTags(html).find((t) => (t.name ?? t.property ?? "").toLowerCase() === key);
  return tag?.content !== undefined ? decode(tag.content) : null;
}

export function readHtml(html: string) {
  const head = html.slice(0, 400_000);
  const title = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const ldTypes: string[] = [];
  for (const m of head.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if ((attrsOf(m[1]).type ?? "").toLowerCase() !== "application/ld+json") continue;
    try {
      const data = JSON.parse(m[2]);
      for (const item of (Array.isArray(data) ? data : [data]).flatMap((d) => [d, ...(Array.isArray(d?.["@graph"]) ? d["@graph"] : [])])) {
        const t = item?.["@type"];
        for (const one of Array.isArray(t) ? t : [t]) if (typeof one === "string") ldTypes.push(one);
      }
    } catch { /* not JSON — doesn't count */ }
  }
  return {
    title: title !== undefined ? decode(title.replace(/<[^>]+>/g, "")) : null,
    description: meta(head, "description"),
    h1Count: (head.match(/<h1\b/gi) ?? []).length,
    canonical: tags(head, "link").some((l) => (l.rel ?? "").toLowerCase().split(/\s+/).includes("canonical")),
    viewport: meta(head, "viewport") !== null,
    ogTitle: meta(head, "og:title"),
    ogImage: meta(head, "og:image"),
    lang: tags(head, "html")[0]?.lang || null,
    ldTypes,
  };
}

// ── robots.txt ────────────────────────────────────────────────────────────────────────

/** Whether robots.txt blocks a user agent from the whole site (Disallow: / without Allow: /). */
export function blocksWholeSite(robots: string | null, agent: string): boolean {
  if (!robots) return false;
  const groups: { agents: string[]; rules: [string, string][] }[] = [];
  let current: { agents: string[]; rules: [string, string][] } | null = null;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const [field, value] = [m[1].toLowerCase(), m[2].trim()];
    if (field === "user-agent") {
      if (!current || current.rules.length) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
    } else if (current && (field === "disallow" || field === "allow")) {
      current.rules.push([field, value]);
    }
  }
  const specific = groups.filter((g) => g.agents.includes(agent.toLowerCase()));
  const applicable = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  const rules = applicable.flatMap((g) => g.rules);
  return rules.some(([f, v]) => f === "disallow" && v === "/") && !rules.some(([f, v]) => f === "allow" && v === "/");
}

const looksLikeHtml = (s: string) => /^\s*(<!doctype|<html|<head|<body)/i.test(s);

// ── The checks ────────────────────────────────────────────────────────────────────────

export function runChecks(f: Fetched): Check[] {
  const p = readHtml(f.html);
  const titleLen = p.title?.length ?? 0;
  const descLen = p.description?.length ?? 0;
  const blockedAll = blocksWholeSite(f.robots, "Googlebot");
  const blockedAi = AI_CRAWLERS.filter((a) => blocksWholeSite(f.robots, a));
  const llms = f.llms && !looksLikeHtml(f.llms) && f.llms.trim().length > 20;
  const sitemap = (f.sitemap && /<(urlset|sitemapindex)\b/i.test(f.sitemap)) || /^\s*sitemap\s*:/im.test(f.robots ?? "");
  const business = p.ldTypes.some((t) => /^(Organization|LocalBusiness|Corporation|Store|Restaurant|ProfessionalService|.*Business)$/.test(t));

  const c = (id: string, group: CheckGroup, label: string, points: number, passed: boolean, detail: string, fix: string): Check => ({ id, group, label, points, passed, detail, fix });

  return [
    c("title", "search", "Page title", 10, titleLen >= 15 && titleLen <= 65,
      p.title ? `“${p.title.slice(0, 80)}” — ${titleLen} characters` : "No <title> tag",
      "Give the page a 15–65 character title that says what the business is and where."),
    c("description", "search", "Meta description", 10, descLen >= 70 && descLen <= 170,
      p.description ? `${descLen} characters` : "None — search engines will pick text from the page",
      "Add a 70–170 character description: what you offer, for whom, and where."),
    c("h1", "search", "One main heading (H1)", 5, p.h1Count === 1,
      p.h1Count === 1 ? "One H1" : `${p.h1Count} H1 headings`,
      "Use exactly one <h1> stating what the page is about."),
    c("canonical", "search", "Canonical address", 5, p.canonical,
      p.canonical ? "Declared" : "Not declared",
      "Add <link rel=\"canonical\"> so search engines know the one address to rank."),
    c("viewport", "search", "Mobile-friendly viewport", 5, p.viewport,
      p.viewport ? "Set" : "Missing — the page may render as a shrunken desktop page on phones",
      "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">."),
    c("https", "search", "Served over HTTPS", 5, f.finalUrl.startsWith("https://"),
      f.finalUrl.startsWith("https://") ? "Yes" : "No — browsers mark the site as not secure",
      "Serve the site over HTTPS and redirect http:// to it."),
    c("sitemap", "search", "Sitemap", 5, !!sitemap,
      sitemap ? "Found" : "No sitemap.xml and none listed in robots.txt",
      "Publish /sitemap.xml listing your pages, and reference it in robots.txt."),
    c("crawlable", "search", "Open to search engines", 5, !blockedAll,
      blockedAll ? "robots.txt blocks the whole site" : "Not blocked",
      "Remove “Disallow: /” for all crawlers in robots.txt."),
    c("jsonld", "ai", "Structured data", 10, p.ldTypes.length > 0,
      p.ldTypes.length ? `Found: ${[...new Set(p.ldTypes)].slice(0, 4).join(", ")}` : "None — search engines and AI assistants have to guess what this business is",
      "Add schema.org JSON-LD describing the business: name, type, contact, address, hours."),
    c("business", "ai", "Business identity in structured data", 5, business,
      business ? "The business is described" : "No Organization or LocalBusiness entry",
      "Describe the business itself (Organization or LocalBusiness) in the JSON-LD."),
    c("og", "ai", "Link previews (Open Graph)", 10, !!p.ogTitle && !!p.ogImage,
      p.ogTitle && p.ogImage ? "Title and image set" : p.ogTitle ? "Title set, no image — shared links show no picture" : "Not set — shared links show a bare URL",
      "Add og:title, og:description and a 1200×630 og:image."),
    c("llms", "ai", "llms.txt for AI assistants", 10, !!llms,
      llms ? "Found" : "No /llms.txt",
      "Publish /llms.txt: a plain map of your site and business for AI assistants."),
    c("ai-crawlers", "ai", "AI crawlers allowed", 10, blockedAi.length === 0,
      blockedAi.length ? `robots.txt blocks ${blockedAi.join(", ")}` : `${AI_CRAWLERS.join(", ")} can read the site`,
      "Allow the AI crawlers in robots.txt if you want ChatGPT, Claude and Perplexity to know your business."),
    c("lang", "ai", "Language declared", 5, !!p.lang,
      p.lang ? `lang="${p.lang}"` : "No lang attribute on <html>",
      "Add lang=\"en\" (or your language) to the <html> tag."),
  ];
}

export function grade(score: number): CheckResult["grade"] {
  return score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "E";
}

export function scoreChecks(domain: string, url: string, checks: Check[], at: number): CheckResult {
  const score = checks.filter((c) => c.passed).reduce((n, c) => n + c.points, 0);
  return { domain, url, score, grade: grade(score), passed: checks.filter((c) => c.passed).length, total: checks.length, checks, checkedAt: at };
}

/** "https://www.Example.com/about?x" → { domain: "example.com", url: "https://www.example.com/" }. Null if it isn't a public website address. */
export function siteFrom(raw: string): { domain: string; url: string } | null {
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || /^\d+(\.\d+){3}$/.test(host) || host.length > 253) return null;
  return { domain: host.replace(/^www\./, ""), url: `${u.protocol}//${host}/` };
}

export const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
