import { allGuides } from "@/lib/guides";
import { SITE_NAME, SITE_URL, url } from "@/lib/seo";

// /guides/feed.xml — the guides as RSS 2.0.
//
// A sitemap tells a crawler what exists. A feed tells everything that subscribes — readers,
// newsletters, aggregators, the AI crawlers that poll feeds for fresh pages — that something
// new arrived, without them having to re-crawl the site to find out. It is the cheapest
// distribution channel there is: write a guide, and it reaches every subscriber on its own.
//
// Built from lib/guides.ts like the sitemap and llms.txt, so the three can never disagree.

export const dynamic = "force-static";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function GET() {
  const guides = allGuides();
  const latest = guides.reduce((m, g) => (g.updated > m ? g.updated : m), guides[0]?.updated ?? "1970-01-01");

  const items = guides.map((g) => {
    const link = url(`/guides/${g.slug}`);
    return [
      "    <item>",
      `      <title>${esc(g.title)}</title>`,
      `      <link>${link}</link>`,
      `      <guid isPermaLink="true">${link}</guid>`,
      `      <description>${esc(g.description)}</description>`,
      `      <pubDate>${new Date(g.published).toUTCString()}</pubDate>`,
      "    </item>",
    ].join("\n");
  }).join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(SITE_NAME)} guides</title>
    <link>${url("/guides")}</link>
    <atom:link href="${url("/guides/feed.xml")}" rel="self" type="application/rss+xml" />
    <description>Marketing guides written from what we actually built and measured at ${esc(SITE_NAME)}.</description>
    <language>en</language>
    <lastBuildDate>${new Date(latest).toUTCString()}</lastBuildDate>
    <image>
      <url>${SITE_URL}/apple-icon.png</url>
      <title>${esc(SITE_NAME)} guides</title>
      <link>${url("/guides")}</link>
    </image>
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
