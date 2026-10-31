// Audit a live site the way a search engine sees it:  node scripts/site-audit.ts [origin]
//
// Reads robots.txt and the sitemap, fetches every page in it, every share image, every
// same-site link and llms.txt, and checks them with lib/site-audit/audit.ts. Prints what's
// wrong and exits 1 if anything is an error — the GitHub workflow runs it against
// www.trypopulr.in daily and after each production deploy.

import { pageIssues, readPageFacts, siteIssues, sitemapUrls, type Issue, type PageFacts } from "../lib/site-audit/audit.ts";
import { parseRobots, verdictFor } from "../lib/tools/robots.ts";

const origin = (process.argv[2] ?? "https://www.trypopulr.in").replace(/\/$/, "");
const UA = "PopulrSelfAudit/1.0 (+https://www.trypopulr.in)";
const issues: Issue[] = [];
const add = (level: Issue["level"], url: string, check: string, detail: string) => issues.push({ level, url, check, detail });

async function getOnce(url: string, redirect: RequestRedirect) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { redirect, headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
    const body = r.headers.get("content-type")?.startsWith("image/") ? "" : await r.text();
    return { status: r.status, type: r.headers.get("content-type") ?? "", location: r.headers.get("location"), body, ms: Date.now() - t0, bytes: Number(r.headers.get("content-length")) || body.length };
  } catch (e) {
    return { status: 0, type: "", location: null, body: "", ms: Date.now() - t0, bytes: 0, error: String(e) };
  }
}

// A dropped connection or a 5xx during a deploy is the network, not the site. Asked again
// after a pause, a real problem is still there; a blip isn't — and an alarm that cries wolf
// every few days is one people stop reading.
async function get(url: string, redirect: RequestRedirect = "manual") {
  let r = await getOnce(url, redirect);
  for (const wait of [1_500, 5_000]) {
    if (r.status !== 0 && r.status < 500) break;
    await new Promise((res) => setTimeout(res, wait));
    r = await getOnce(url, redirect);
  }
  return r;
}
const answered = (r: { status: number; error?: string }) => (r.status ? `answers ${r.status}` : "didn't answer (tried three times)");

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

// ── robots.txt and the sitemap ─────────────────────────────────────────────────────────
const robots = await get(`${origin}/robots.txt`);
if (robots.status !== 200) add("error", `${origin}/robots.txt`, "robots", `robots.txt ${answered(robots)}.`);
const groups = parseRobots(robots.body);
const named = [...robots.body.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1]);
if (!named.includes(`${origin}/sitemap.xml`)) add("error", `${origin}/robots.txt`, "robots", "robots.txt doesn't point to /sitemap.xml.");

const sitemap = await get(`${origin}/sitemap.xml`);
if (sitemap.status !== 200) { add("error", `${origin}/sitemap.xml`, "sitemap", `sitemap.xml ${answered(sitemap)}.`); }
const urls = sitemapUrls(sitemap.body);
if (!urls.length) add("error", `${origin}/sitemap.xml`, "sitemap", "The sitemap lists no pages.");
for (const m of sitemap.body.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)) {
  if (Date.parse(m[1]) > Date.now() + 86_400_000) { add("warning", `${origin}/sitemap.xml`, "sitemap", `A lastmod is in the future (${m[1]}).`); break; }
}
for (const u of urls) {
  if (!u.startsWith(origin + "/") && u !== origin) add("error", u, "sitemap", `Listed under a different host than ${origin}.`);
  else if (!verdictFor(groups, "Googlebot", new URL(u).pathname).allowed) add("error", u, "robots", "In the sitemap, but robots.txt blocks Googlebot from it.");
}

// ── every page ────────────────────────────────────────────────────────────────────────
const facts: PageFacts[] = [];
const timings: { url: string; ms: number; bytes: number }[] = [];
await pool(urls, 4, async (url) => {
  const r = await get(url);
  if (r.status >= 300 && r.status < 400) { add("error", url, "status", `Redirects (${r.status}) to ${r.location} — the sitemap should list the final URL.`); return; }
  if (r.status !== 200) { add("error", url, "status", `Answered ${r.status || ("error" in r ? r.error : "nothing")}.`); return; }
  timings.push({ url, ms: r.ms, bytes: r.bytes });
  if (r.ms > 2500) add("warning", url, "speed", `Took ${r.ms}ms to answer.`);
  if (r.bytes > 600_000) add("warning", url, "weight", `${Math.round(r.bytes / 1000)} KB of HTML.`);
  const f = readPageFacts(r.body, url);
  facts.push(f);
  issues.push(...pageIssues(f));
});
issues.push(...siteIssues(facts));

// ── share images, links, llms.txt ─────────────────────────────────────────────────────
const images = [...new Set(facts.map((f) => f.og.image).filter((x): x is string => !!x))];
await pool(images, 4, async (img) => {
  const r = await get(img, "follow");
  if (r.status !== 200 || !r.type.startsWith("image/")) add("error", img, "og-image", `Share image answered ${r.status} ${r.type}.`);
});

const linkSources = new Map<string, string>();
for (const f of facts) for (const l of f.links) if (!linkSources.has(l)) linkSources.set(l, f.url);
const links = [...linkSources.keys()].filter((l) => verdictFor(groups, "Googlebot", new URL(l).pathname).allowed);
await pool(links, 6, async (link) => {
  const r = await get(link);
  const from = linkSources.get(link)!;
  if (r.status >= 300 && r.status < 400) add("warning", from, "links", `Links to ${link}, which redirects to ${r.location}. Link to the final URL.`);
  else if (r.status !== 200) add("error", from, "links", `Links to ${link}, which ${answered(r)}.`);
});

const llms = await get(`${origin}/llms.txt`);
if (llms.status !== 200 || !/^#\s+\S/.test(llms.body)) add("error", `${origin}/llms.txt`, "llms-txt", `llms.txt answered ${llms.status} or doesn't start with an H1.`);

// ── speed, as Google measures it ──────────────────────────────────────────────────────
// PageSpeed Insights on a phone, for the home page and a tool page. Its free quota is shared
// and often spent, so a missing answer is reported, not failed: set PAGESPEED_API_KEY to make
// it dependable. Lab numbers move a little run to run, so these are warnings.
const speed: string[] = [];
for (const path of ["/", "/tools/ai-crawler-checker"]) {
  const q = new URLSearchParams({ url: `${origin}${path}`, strategy: "mobile", category: "performance" });
  if (process.env.PAGESPEED_API_KEY) q.set("key", process.env.PAGESPEED_API_KEY);
  try {
    const r = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`, { signal: AbortSignal.timeout(90_000) });
    const d = await r.json() as { error?: { code: number }; lighthouseResult?: { categories: { performance: { score: number } }; audits: Record<string, { numericValue: number }> }; loadingExperience?: { overall_category?: string } };
    if (!d.lighthouseResult) { speed.push(`${path}: not measured (PageSpeed answered ${d.error?.code ?? r.status})`); continue; }
    const score = Math.round(d.lighthouseResult.categories.performance.score * 100);
    const lcp = d.lighthouseResult.audits["largest-contentful-paint"].numericValue, cls = d.lighthouseResult.audits["cumulative-layout-shift"].numericValue;
    speed.push(`${path}: performance ${score}, LCP ${(lcp / 1000).toFixed(1)}s, CLS ${cls.toFixed(3)}, real users: ${d.loadingExperience?.overall_category ?? "not enough data yet"}`);
    if (score < 90) add("warning", `${origin}${path}`, "speed", `PageSpeed performance ${score} on mobile (aim for 90+).`);
    if (lcp > 2500) add("warning", `${origin}${path}`, "speed", `Largest contentful paint ${(lcp / 1000).toFixed(1)}s on mobile (aim for under 2.5s).`);
    if (cls > 0.1) add("warning", `${origin}${path}`, "speed", `Layout shift ${cls.toFixed(3)} (aim for under 0.1).`);
  } catch {
    speed.push(`${path}: not measured (PageSpeed didn't answer)`);
  }
}

// ── report ────────────────────────────────────────────────────────────────────────────
const errors = issues.filter((i) => i.level === "error"), warnings = issues.filter((i) => i.level === "warning");
const slowest = timings.sort((a, b) => b.ms - a.ms)[0];
console.log(`SEO audit of ${origin}: ${facts.length}/${urls.length} pages read, ${links.length} links and ${images.length} share images checked.`);
if (slowest) console.log(`Slowest page: ${slowest.url} (${slowest.ms}ms).`);
for (const line of speed) console.log(`Speed ${line}`);
for (const [label, list] of [["Errors", errors], ["Warnings", warnings]] as const) {
  if (!list.length) continue;
  console.log(`\n${label} (${list.length}):`);
  for (const i of list.sort((a, b) => a.url.localeCompare(b.url))) console.log(`  [${i.check}] ${i.url.replace(origin, "") || "/"} — ${i.detail}`);
}
if (!errors.length && !warnings.length) console.log("\nNo problems found.");
process.exit(errors.length ? 1 : 0);
