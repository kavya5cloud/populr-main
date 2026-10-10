import { safeFetchText } from "@/lib/net/safe-fetch";
import { discoverFeed, parseFeed, type FeedItem } from "./feed";
import { SourceRegistry, SOURCE_SPECS } from "./sources";
import type {
  MarketQuery, MarketSignal, MarketSource, MarketSourceId, SourceCapabilities, SourceHealth,
} from "./types";
import { clamp01, DAY_MS, idFrom, normalizeTopic, saturate } from "./util";

// Real market sources.
//
// sources.ts holds the reference adapters: deterministic, offline, and labelled "Google
// Trends" and "Reddit" while generating every number from a hash of the topic. They were
// the scaffold real providers were meant to replace, and they were wired into production
// and into every post's context as if they were data. These replace them there. The
// reference adapters stay, for tests, which is the job they are honest about.
//
// Every number below is a count of something that was actually observed — articles,
// threads, comments, posts — over a stated window. Nothing is estimated. Where a source has
// no real equivalent (Google Trends publishes no API), it is not registered at all, so it
// shows up as unavailable rather than as a confident invented figure.
//
// Each adapter emits ONE signal per search term, aggregated from the items it found, and
// carries the items themselves in `raw.items` — so anything built on a signal can cite the
// articles and threads behind it rather than asserting a trend.

const WEEK = 7 * DAY_MS;
const HTTP_TIMEOUT_MS = 6_000;

export type Citation = { title: string; url: string; publisher?: string; publishedAt: number | null; score?: number; comments?: number };

function caps(id: MarketSourceId): SourceCapabilities {
  const s = SOURCE_SPECS[id];
  return { id, label: s.label, kinds: s.kinds, rateLimitPerMin: s.rateLimitPerMin, incremental: s.incremental };
}

/**
 * How fast something is rising, from real timestamps alone. Share of the window's items
 * that landed in its most recent 2/7: an even spread reads 0.5, everything recent reads 1.
 */
function recency(times: number[], now: number, windowMs: number): number {
  if (!times.length) return 0;
  const recentCut = now - (windowMs * 2) / 7;
  const recent = times.filter((t) => t >= recentCut).length;
  return clamp01((recent / times.length) * (7 / 4));
}

function seedTerms(q: MarketQuery, max = 3): string[] {
  return [...new Set(q.terms.map((t) => t.trim()).filter(Boolean))].slice(0, max);
}

async function getText(url: string, headers: Record<string, string> = {}): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; PopulrResearch/1.0; +https://www.trypopulr.in)", ...headers }, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ---------------------------------------------------------------- News

/** Google News search, as RSS. Public, no key, and it names each article's publisher. */
export class NewsSource implements MarketSource {
  readonly id = "news" as const;
  constructor(private now: () => number = Date.now, private region = { hl: "en-IN", gl: "IN", ceid: "IN:en" }) {}
  capabilities() { return caps(this.id); }

  searchUrl(term: string) {
    // A multi-word term is quoted. Unquoted, Google News matches the words loosely, and
    // "kirana delivery" returned an eye-care programme called Asha Kirana.
    const phrase = /\s/.test(term.trim()) ? `"${term.trim()}"` : term.trim();
    const q = encodeURIComponent(`${phrase} when:7d`);
    return `https://news.google.com/rss/search?q=${q}&hl=${this.region.hl}&gl=${this.region.gl}&ceid=${this.region.ceid}`;
  }

  async collect(q: MarketQuery): Promise<MarketSignal[]> {
    const now = this.now();
    const out: MarketSignal[] = [];
    for (const term of seedTerms(q)) {
      const items = parseFeed(await getText(this.searchUrl(term)))
        .filter((i) => i.publishedAt !== null && i.publishedAt >= now - WEEK);
      if (!items.length) continue;
      out.push(signal(this.id, "article", term, q, now, {
        title: `${items.length} news article${items.length === 1 ? "" : "s"} on "${term}" in the last 7 days`,
        url: this.searchUrl(term),
        strength: saturate(items.length, 25),
        velocity: recency(items.map((i) => i.publishedAt!), now, WEEK),
        raw: { method: "Google News RSS, last 7 days", articles7d: items.length, items: top(items, 5) },
      }));
    }
    return out.filter((s) => s.observedAt >= (q.since ?? 0));
  }

  async health(): Promise<SourceHealth> {
    try { await getText(this.searchUrl("marketing")); return { source: this.id, healthy: true }; }
    catch (e) { return { source: this.id, healthy: false, detail: String(e).slice(0, 120) }; }
  }
}

// ---------------------------------------------------------------- Reddit

type RedditPost = { title: string; permalink: string; subreddit: string; score: number; num_comments: number; created_utc: number };

/**
 * Reddit search over the past week.
 *
 * With REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET set it uses an app-only OAuth token,
 * which is the supported way in. Without them it tries the public JSON endpoint, which
 * Reddit often refuses from cloud servers — in which case this source fails and is
 * reported as degraded, which is the truth.
 */
export class RedditSource implements MarketSource {
  readonly id = "reddit" as const;
  private token: { value: string; until: number } | null = null;
  constructor(private now: () => number = Date.now) {}
  capabilities() { return caps(this.id); }

  private async auth(): Promise<string | null> {
    const id = process.env.REDDIT_CLIENT_ID, secret = process.env.REDDIT_CLIENT_SECRET;
    if (!id || !secret) return null;
    if (this.token && this.token.until > Date.now() + 60_000) return this.token.value;
    const res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "PopulrResearch/1.0" },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`reddit auth HTTP ${res.status}`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, until: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  private async search(term: string): Promise<RedditPost[]> {
    const qs = `q=${encodeURIComponent(term)}&sort=relevance&t=week&limit=25&raw_json=1`;
    const token = await this.auth();
    const body = token
      ? await getText(`https://oauth.reddit.com/search?${qs}`, { Authorization: `Bearer ${token}` })
      : await getText(`https://www.reddit.com/search.json?${qs}`);
    const j = JSON.parse(body) as { data?: { children?: { data: RedditPost }[] } };
    return (j.data?.children ?? []).map((c) => c.data);
  }

  async collect(q: MarketQuery): Promise<MarketSignal[]> {
    const now = this.now();
    const out: MarketSignal[] = [];
    for (const term of seedTerms(q)) {
      const posts = (await this.search(term)).filter((p) => p.created_utc * 1000 >= now - WEEK);
      if (!posts.length) continue;
      const engagement = posts.reduce((n, p) => n + Math.max(0, p.score) + p.num_comments, 0);
      const ranked = [...posts].sort((a, b) => b.score + b.num_comments - (a.score + a.num_comments));
      out.push(signal(this.id, "discussion", term, q, now, {
        title: `${posts.length} Reddit thread${posts.length === 1 ? "" : "s"} on "${term}" this week`,
        url: `https://www.reddit.com/search/?q=${encodeURIComponent(term)}&t=week`,
        strength: saturate(engagement, 400),
        velocity: recency(posts.map((p) => p.created_utc * 1000), now, WEEK),
        raw: {
          method: "Reddit search, last 7 days",
          threads7d: posts.length, upvotes: posts.reduce((n, p) => n + Math.max(0, p.score), 0),
          comments: posts.reduce((n, p) => n + p.num_comments, 0),
          items: ranked.slice(0, 5).map<Citation>((p) => ({
            title: p.title, url: `https://www.reddit.com${p.permalink}`, publisher: `r/${p.subreddit}`,
            publishedAt: p.created_utc * 1000, score: p.score, comments: p.num_comments,
          })),
        },
      }));
    }
    return out.filter((s) => s.observedAt >= (q.since ?? 0));
  }

  async health(): Promise<SourceHealth> {
    try { await this.search("marketing"); return { source: this.id, healthy: true }; }
    catch (e) { return { source: this.id, healthy: false, detail: String(e).slice(0, 120) }; }
  }
}

// ---------------------------------------------------------------- Competitor websites

/**
 * What a competitor has been publishing, from the feed their own site advertises.
 *
 * Competitors are typed in by customers, so every fetch goes through safeFetchText. A
 * competitor given as a bare name (no domain) is skipped: guessing which website a name
 * belongs to is exactly the kind of confident invention this module exists to avoid.
 */
export class CompetitorWebSource implements MarketSource {
  readonly id = "competitor_web" as const;
  constructor(private now: () => number = Date.now) {}
  capabilities() { return caps(this.id); }

  async collect(q: MarketQuery): Promise<MarketSignal[]> {
    const now = this.now();
    const out: MarketSignal[] = [];
    for (const c of (q.competitors ?? []).slice(0, 5)) {
      const site = asSiteUrl(c);
      if (!site) continue;
      const page = await safeFetchText(site, { maxBytes: 800_000 });
      const found = await findFeed(page.text, page.url);
      if (!found) continue;
      const { url: feedUrl, items: all } = found;
      const items = all.filter((i) => i.publishedAt !== null && i.publishedAt >= now - 30 * DAY_MS);
      if (!items.length) continue;
      const name = new URL(page.url).hostname.replace(/^www\./, "");
      out.push({
        ...signal(this.id, "competitor_post", name, q, now, {
          title: `${name} published ${items.length} post${items.length === 1 ? "" : "s"} in the last 30 days`,
          url: page.url,
          strength: saturate(items.length, 8),
          velocity: recency(items.map((i) => i.publishedAt!), now, 30 * DAY_MS),
          raw: { method: "competitor's own feed, last 30 days", posts30d: items.length, feed: feedUrl, items: top(items, 5) },
        }),
        competitor: name,
      });
    }
    return out.filter((s) => s.observedAt >= (q.since ?? 0));
  }

  async health(): Promise<SourceHealth> { return { source: this.id, healthy: true, detail: "checked per competitor" }; }
}

/**
 * The feed a site advertises, or failing that, one at a conventional path.
 *
 * Plenty of real sites publish a feed without advertising it in their <head> (HubSpot's
 * blog is one). Probing the usual paths is checking, not guessing: a candidate only counts
 * if it parses as a feed and has items.
 */
const FEED_PATHS = ["/feed", "/rss.xml", "/feed.xml", "/atom.xml", "/blog/feed", "/rss"];

async function findFeed(html: string, pageUrl: string): Promise<{ url: string; items: FeedItem[] } | null> {
  const advertised = discoverFeed(html, pageUrl);
  const candidates = advertised ? [advertised] : FEED_PATHS.map((p) => new URL(p, pageUrl).toString());
  for (const url of candidates) {
    try {
      const items = parseFeed((await safeFetchText(url, { maxBytes: 2_000_000 })).text);
      if (items.length) return { url, items };
    } catch { /* not here — try the next one */ }
  }
  return null;
}

function asSiteUrl(s: string): string | null {
  const t = s.trim();
  if (!/^https?:\/\//i.test(t) && !/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(t)) return null;
  try { return new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`).toString(); } catch { return null; }
}

// ---------------------------------------------------------------- RSS

/** Configured industry feeds (MARKET_RSS_FEEDS, comma-separated), filtered to the query terms. */
export class RssSource implements MarketSource {
  readonly id = "rss" as const;
  constructor(private feeds: string[], private now: () => number = Date.now) {}
  capabilities() { return caps(this.id); }

  async collect(q: MarketQuery): Promise<MarketSignal[]> {
    const now = this.now();
    const all: FeedItem[] = [];
    for (const f of this.feeds.slice(0, 10)) {
      try { all.push(...parseFeed((await safeFetchText(f)).text)); } catch { /* one dead feed is not a dead source */ }
    }
    const out: MarketSignal[] = [];
    for (const term of seedTerms(q)) {
      const needle = term.toLowerCase();
      const items = all.filter((i) => i.publishedAt !== null && i.publishedAt >= now - WEEK && i.title.toLowerCase().includes(needle));
      if (!items.length) continue;
      out.push(signal(this.id, "article", term, q, now, {
        title: `${items.length} item${items.length === 1 ? "" : "s"} on "${term}" across your feeds this week`,
        strength: saturate(items.length, 10),
        velocity: recency(items.map((i) => i.publishedAt!), now, WEEK),
        raw: { method: "configured RSS feeds, last 7 days", items7d: items.length, items: top(items, 5) },
      }));
    }
    return out.filter((s) => s.observedAt >= (q.since ?? 0));
  }

  async health(): Promise<SourceHealth> { return { source: this.id, healthy: this.feeds.length > 0 }; }
}

// ---------------------------------------------------------------- helpers

function top(items: FeedItem[], n: number): Citation[] {
  return [...items]
    .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
    .slice(0, n)
    .map((i) => ({ title: stripPublisher(i.title, i.publisher), url: i.url, publisher: i.publisher, publishedAt: i.publishedAt }));
}

/** Google News appends " - Publisher" to every headline; the publisher is its own field. */
function stripPublisher(title: string, publisher?: string): string {
  if (publisher && title.endsWith(` - ${publisher}`)) return title.slice(0, -(publisher.length + 3));
  return title.replace(/\s+-\s+[^-]{2,60}$/, "");
}

function signal(
  source: MarketSourceId, kind: MarketSignal["kind"], term: string, q: MarketQuery, now: number,
  f: { title: string; url?: string; strength: number; velocity: number; raw: Record<string, unknown> },
): MarketSignal {
  const topic = normalizeTopic(term);
  return {
    id: idFrom("sig", source, topic, q.tenant, Math.floor(now / DAY_MS)),
    source, kind, topic, title: f.title, url: f.url,
    strength: clamp01(f.strength * SOURCE_SPECS[source].weight),
    velocity: f.velocity,
    audience: q.audience,
    observedAt: now,
    raw: { ...f.raw, live: true },
  };
}

/**
 * The production registry: real sources only.
 *
 * google_trends is deliberately absent — there is no official API, and the reference
 * adapter's numbers were invented. social and analytics come from the workspace's own
 * connected accounts and Search Console, which are read elsewhere; they are not registered
 * here until they read real data. An absent source is reported as unavailable, which is
 * what it is.
 */
export function createLiveSourceRegistry(now: () => number = Date.now): SourceRegistry {
  const reg = new SourceRegistry();
  reg.register(new NewsSource(now));
  reg.register(new RedditSource(now));
  reg.register(new CompetitorWebSource(now));
  const feeds = (process.env.MARKET_RSS_FEEDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (feeds.length) reg.register(new RssSource(feeds, now));
  return reg;
}
