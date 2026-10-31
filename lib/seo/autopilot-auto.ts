import { safeFetchText } from "@/lib/net/safe-fetch";
import { pagePath, type AutopilotConfig, type BusinessDetails, type PageFix } from "./autopilot";
import type { AutopilotStore } from "./autopilot-store";
import { needsFix, pageUrl, readPage, suggestFix } from "./autopilot-suggest";

// Automatic mode: Populr fixes a site's pages without waiting for approval.
//
// It's switched on by turning Populr on from a code editor, and that is the sign-off for
// what follows. Everything else still holds: a fix is drafted only from what the page itself
// says, every number in it checked against the page, and only for pages whose title or
// description is actually broken — a title someone already got right is left alone. Each
// automatic fix is listed in the dashboard with an undo, and a page whose fix was undone is
// never touched again.
//
// Two ways in: turning on (the main pages, now) and the snippet's beacon (a page it hasn't
// reported before, later). The beacon is public, so that path is bounded per site per day.

export const AUTO_PER_DAY = 10;
export const MAX_PAGES = 50;
const TURN_ON_PAGES = 5;
const TURN_ON_BUDGET_MS = 30_000;

export type AutoDeps = {
  fetch?: (url: string) => Promise<{ status: number; text: string; url?: string }>;
  suggest?: typeof suggestFix;
  now?: () => number;
};

const get = (deps: AutoDeps) => deps.fetch ?? ((url: string) => safeFetchText(url, { maxBytes: 1_500_000, timeoutMs: 10_000 }));
const clock = (deps: AutoDeps) => (deps.now ?? Date.now)();
const host = (u: string) => new URL(u).hostname.replace(/^www\./, "");
/** Where a redirect ended up still counts as the site when only "www." differs. */
const stayed = (site: string, r: { url?: string }) => !r.url || host(r.url) === host(site);

export type AutoResult =
  | { path: string; outcome: "fixed"; fix: PageFix; reasons: string[] }
  | { path: string; outcome: "fine" }
  | { path: string; outcome: "skipped" | "failed"; reason: string };

/**
 * Checks one page and, when its title or description is broken, drafts an approved fix for
 * the broken part only. `html` skips the fetch when the page was already loaded.
 */
export async function autoFixPage(cfg: Pick<AutopilotConfig, "site" | "business">, path: string, deps: AutoDeps, opts: { html?: string; homeTitle?: string | null } = {}): Promise<AutoResult> {
  const p = pagePath(path);
  const url = pageUrl(cfg.site, p);
  if (!url) return { path: p, outcome: "skipped", reason: "not a page on the site" };
  let html = opts.html;
  if (html === undefined) {
    try {
      const r = await get(deps)(url);
      if (r.status !== 200) return { path: p, outcome: "skipped", reason: `the page answered ${r.status}` };
      if (!stayed(cfg.site, r)) return { path: p, outcome: "skipped", reason: "the page redirects off the site" };
      html = r.text;
    } catch { return { path: p, outcome: "failed", reason: "couldn't load the page" }; }
  }
  if (/<meta\b[^>]*name=["']?robots["']?[^>]*content=["'][^"']*noindex/i.test(html)) return { path: p, outcome: "skipped", reason: "the page asks search engines not to index it" };

  const page = readPage(html);
  const broken = needsFix(page, p === "/" ? null : opts.homeTitle);
  if (!broken) return { path: p, outcome: "fine" };
  const s = await (deps.suggest ?? suggestFix)(cfg.site, p, cfg.business?.name || new URL(cfg.site).hostname, { fetchPage: async () => html! });
  if (!s.ok) return { path: p, outcome: "failed", reason: s.error };
  const fix: PageFix = {
    ...(broken.title ? { title: s.fix.title } : {}),
    ...(broken.description ? { description: s.fix.description } : {}),
    status: "approved", by: "auto", before: s.fix.before, at: clock(deps),
  };
  return { path: p, outcome: "fixed", fix, reasons: Object.values(broken) };
}

const SKIP_PATH = /^\/(api|_next|static|assets|cdn-cgi|wp-admin|wp-json|login|log-in|signin|sign-in|signup|sign-up|register|cart|checkout|account|admin)(\/|$)/i;
const SKIP_FILE = /\.(pdf|jpe?g|png|gif|svg|webp|avif|ico|zip|xml|txt|json|mp4|mp3|css|js)$/i;

/** The site's own pages linked from a page, shallowest first: the ones its navigation leads to. */
export function internalPaths(html: string, site: string, max: number): string[] {
  const found: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
    const href = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (!href || href.startsWith("#")) continue;
    const u = pageUrl(site, href);
    if (!u) continue;
    const p = pagePath(new URL(u).pathname);
    if (p === "/" || SKIP_PATH.test(p) || SKIP_FILE.test(p) || found.includes(p)) continue;
    found.push(p);
  }
  const depth = (p: string) => p.split("/").length;
  return found.map((p, i) => ({ p, i })).sort((a, b) => depth(a.p) - depth(b.p) || a.i - b.i).slice(0, max).map((x) => x.p);
}

export type TurnOn =
  | { status: "on"; config: AutopilotConfig; results: AutoResult[]; approvedDrafts: string[] }
  | { status: "different_site_set_up"; site: string };

/**
 * Turning Populr on: the site in automatic mode with the snippet switched on, any drafts
 * waiting for approval approved, and the main pages checked and fixed where they need it.
 */
export async function turnOn(store: AutopilotStore, workspace: string, input: { site: string; business: BusinessDetails | null }, deps: AutoDeps = {}): Promise<TurnOn> {
  const started = clock(deps);
  const prev = await store.get(workspace);
  if (prev && prev.site !== input.site) return { status: "different_site_set_up", site: prev.site };

  const pages: Record<string, PageFix> = { ...(prev?.pages ?? {}) };
  const approvedDrafts = Object.keys(pages).filter((p) => pages[p].status === "suggested");
  for (const p of approvedDrafts) pages[p] = { ...pages[p], status: "approved" };
  let cfg = await store.save({
    workspace, siteKey: prev?.siteKey, site: input.site, enabled: true, auto: true, autoDay: prev?.autoDay,
    business: input.business ?? prev?.business ?? null, faq: prev?.faq ?? [], pages,
  });

  // The home page first: its links say which pages matter, and its title is the one other
  // pages mustn't copy.
  let home: string | undefined;
  const results: AutoResult[] = [];
  try {
    const r = await get(deps)(new URL("/", input.site).toString());
    if (r.status === 200 && stayed(input.site, r)) home = r.text;
    else if (r.status === 200) results.push({ path: "/", outcome: "skipped", reason: "the home page redirects off the site" });
    else results.push({ path: "/", outcome: "skipped", reason: `the home page answered ${r.status}` });
  } catch { results.push({ path: "/", outcome: "failed", reason: "couldn't load the home page" }); }
  const homeTitle = home ? readPage(home).title : null;
  const queue = [...(home ? ["/"] : []), ...(home ? internalPaths(home, input.site, TURN_ON_PAGES - 1) : [])]
    .filter((p) => !cfg.pages[p]);

  // A few at a time, and nothing new started once the time budget is spent: the editor is
  // waiting on this call.
  const workers = Array.from({ length: 3 }, async () => {
    for (let p = queue.shift(); p !== undefined; p = queue.shift()) {
      if (clock(deps) - started > TURN_ON_BUDGET_MS) { results.push({ path: p, outcome: "skipped", reason: "out of time — Populr checks it when the snippet first sees it" }); continue; }
      results.push(await autoFixPage(cfg, p, deps, { html: p === "/" ? home : undefined, homeTitle }));
    }
  });
  await Promise.all(workers);

  const fixed = results.filter((r): r is Extract<AutoResult, { outcome: "fixed" }> => r.outcome === "fixed");
  if (fixed.length) {
    const fresh = (await store.get(workspace)) ?? cfg;
    const merged = { ...fresh.pages };
    for (const r of fixed) if (!merged[r.path]) merged[r.path] = r.fix;
    cfg = await store.save({ ...fresh, pages: merged });
  }
  return { status: "on", config: cfg, results, approvedDrafts };
}

/**
 * A page the snippet reported for the first time. In automatic mode it's checked and fixed
 * if it needs it — at most AUTO_PER_DAY a day per site, and never a page that already has a
 * fix, a draft, or an undo.
 */
export async function autoFixNewPage(store: AutopilotStore, siteKey: string, path: string, deps: AutoDeps = {}): Promise<AutoResult | null> {
  const c = await store.byKey(siteKey);
  const p = pagePath(path);
  if (!c?.auto || !c.enabled || c.pages[p] || Object.keys(c.pages).length >= MAX_PAGES) return null;
  const day = new Date(clock(deps)).toISOString().slice(0, 10);
  const used = c.autoDay?.day === day ? c.autoDay.count : 0;
  if (used >= AUTO_PER_DAY) return null;
  // Spend the budget before the work, so pages arriving together can't all get past the check.
  await store.save({ ...c, autoDay: { day, count: used + 1 } });

  const r = await autoFixPage(c, p, deps, { homeTitle: c.pages["/"]?.before?.title ?? null });
  if (r.outcome === "fixed") {
    const fresh = await store.byKey(siteKey);
    if (fresh?.auto && !fresh.pages[p]) await store.save({ ...fresh, pages: { ...fresh.pages, [p]: r.fix } });
  }
  return r;
}
