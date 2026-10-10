// A small RSS 2.0 / Atom reader.
//
// No XML dependency: the dependency list is short on purpose, and the four fields read here
// (title, link, date, source) have the same shape in every feed worth reading. Anything
// unparseable is skipped, never guessed at.

export type FeedItem = {
  title: string;
  url: string;
  publishedAt: number | null;
  /** The publisher, where the feed names one (Google News does, per item). */
  publisher?: string;
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  return m ? decodeXml(m[1]) : null;
}

function date(s: string | null): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

export function parseFeed(xml: string): FeedItem[] {
  const out: FeedItem[] = [];

  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const b = m[1];
    const title = tag(b, "title");
    const url = tag(b, "link");
    if (!title || !url) continue;
    out.push({ title, url, publishedAt: date(tag(b, "pubDate") ?? tag(b, "dc:date")), publisher: tag(b, "source") ?? undefined });
  }

  for (const m of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
    const b = m[1];
    const title = tag(b, "title");
    // Atom puts the URL in an attribute; prefer the alternate link.
    const href = b.match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)?.[1]
      ?? b.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1];
    if (!title || !href) continue;
    out.push({ title, url: decodeXml(href), publishedAt: date(tag(b, "published") ?? tag(b, "updated")) });
  }

  return out;
}

/** The feed a web page advertises in its <head>, resolved against the page URL. */
export function discoverFeed(html: string, pageUrl: string): string | null {
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const t = m[0];
    if (!/rel=["']?alternate/i.test(t) || !/type=["']?application\/(rss|atom)\+xml/i.test(t)) continue;
    // Quoted or not: href=https://… is valid HTML and real sites write it (Smashing
    // Magazine does), so requiring quotes silently found no feed on them.
    const href = t.match(/href=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i)?.slice(1).find(Boolean);
    if (href) {
      try { return new URL(decodeXml(href), pageUrl).toString(); } catch { /* malformed — keep looking */ }
    }
  }
  return null;
}
