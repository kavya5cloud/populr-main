import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeXml, discoverFeed, parseFeed } from "@/lib/market/feed";
import { isPrivateAddress, safeFetchText, UnsafeUrlError } from "@/lib/net/safe-fetch";
import { createLiveSourceRegistry, NewsSource } from "@/lib/market/live-sources";

// Real market sources, tested offline.
//
// These replaced reference adapters that generated "Google Trends" and "Reddit" numbers from
// a hash and were fed into every post as data. The property worth pinning above all others:
// every number a live signal carries is a count of something observed.

afterEach(() => { vi.unstubAllGlobals(); });

const NOW = Date.parse("2026-10-10T12:00:00Z");
const day = (n: number) => new Date(NOW - n * 86_400_000).toUTCString();

const newsRss = (items: { t: string; d: string; src?: string }[]) => `<?xml version="1.0"?><rss><channel>
${items.map((i) => `<item><title>${i.t}${i.src ? ` - ${i.src}` : ""}</title><link>https://news.example/${encodeURIComponent(i.t)}</link><pubDate>${i.d}</pubDate>${i.src ? `<source url="https://x">${i.src}</source>` : ""}</item>`).join("\n")}
</channel></rss>`;

describe("the feed reader", () => {
  it("reads RSS and Atom, and skips what it cannot read rather than guessing", () => {
    const rss = parseFeed(`<rss><item><title>A &amp; B</title><link>https://a</link><pubDate>${day(1)}</pubDate></item><item><title>no link</title></item></rss>`);
    expect(rss).toEqual([{ title: "A & B", url: "https://a", publishedAt: Date.parse(day(1)), publisher: undefined }]);
    const atom = parseFeed(`<feed><entry><title><![CDATA[Atom post]]></title><link rel="alternate" href="https://b"/><updated>2026-10-09T00:00:00Z</updated></entry></feed>`);
    expect(atom[0]).toMatchObject({ title: "Atom post", url: "https://b" });
  });

  it("finds an advertised feed with or without quoted attributes", () => {
    // Smashing Magazine writes href=https://… unquoted; requiring quotes found nothing.
    expect(discoverFeed(`<link rel=alternate type=application/rss+xml href=https://s.example/feed/>`, "https://s.example/")).toBe("https://s.example/feed/");
    expect(discoverFeed(`<link rel="alternate" type="application/atom+xml" href="/atom.xml">`, "https://s.example/blog")).toBe("https://s.example/atom.xml");
    expect(discoverFeed(`<link rel="stylesheet" href="/x.css">`, "https://s.example/")).toBeNull();
  });

  it("decodes entities and strips markup", () => {
    expect(decodeXml("<b>Q&amp;A</b> &#8217;s &#x2014;")).toBe("Q&A ’s —");
  });
});

describe("fetching a URL a customer typed", () => {
  it("knows a private address when it sees one", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "142.250.72.14", "2606:4700::1111"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it("refuses internal targets before any request is made", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    for (const u of ["http://169.254.169.254/latest/meta-data/", "http://localhost:5432/", "http://127.0.0.1/", "file:///etc/passwd", "http://user:pw@example.com/"]) {
      await expect(safeFetchText(u), u).rejects.toBeInstanceOf(UnsafeUrlError);
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("re-checks every redirect, so a public URL cannot bounce to a private one", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } })));
    await expect(safeFetchText("http://8.8.8.8/")).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("stops reading a response past the size cap", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x".repeat(5_000))));
    await expect(safeFetchText("http://8.8.8.8/", { maxBytes: 1_000 })).rejects.toThrow(/too large/);
  });
});

describe("news signals are counts of real articles", () => {
  it("counts the week's articles, cites them, and strips the publisher off headlines", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(newsRss([
      { t: "Quick commerce grows", d: day(0.5), src: "Mint" },
      { t: "Dark stores expand", d: day(1), src: "ET Retail" },
      { t: "Old story", d: day(20), src: "Mint" },   // outside the window — must not count
    ]))));
    const [s] = await new NewsSource(() => NOW).collect({ tenant: "t", terms: ["quick commerce"] });

    expect(s.raw.articles7d).toBe(2);
    expect(s.title).toBe('2 news articles on "quick commerce" in the last 7 days');
    const items = s.raw.items as { title: string; publisher: string }[];
    expect(items.map((i) => i.title)).toEqual(["Quick commerce grows", "Dark stores expand"]);
    expect(items[0].publisher).toBe("Mint");
    expect(s.raw.live).toBe(true);
  });

  it("emits nothing for a term with no coverage, instead of a weak invented trend", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(newsRss([]))));
    expect(await new NewsSource(() => NOW).collect({ tenant: "t", terms: ["kirana delivery"] })).toEqual([]);
  });

  it("searches a multi-word term as a phrase", () => {
    // Unquoted, "kirana delivery" matched an eye-care programme called Asha Kirana.
    expect(decodeURIComponent(new NewsSource().searchUrl("kirana delivery"))).toContain('"kirana delivery"');
  });
});

describe("the production registry", () => {
  it("has no Google Trends adapter, because there is no real one to have", () => {
    // Absent means reported as unavailable. The reference adapter it replaces invented
    // search volumes from a hash.
    expect(createLiveSourceRegistry().ids()).not.toContain("google_trends");
  });

  it("registers only sources that read real data", () => {
    expect(createLiveSourceRegistry().ids().sort()).toEqual(["competitor_web", "news", "reddit"]);
  });
});
