import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { blocksWholeSite, readHtml, runChecks, scoreChecks, siteFrom, type Fetched } from "@/lib/check/checks";
import { checkSite, CheckFetchError } from "@/lib/check/run";
import { InMemoryCheckStore } from "@/lib/check/store";

// The free SEO & AI-readiness check: every point is a measured check, the score is their
// total, and the public endpoint can't be turned against anyone's site.

afterEach(() => { vi.resetModules(); vi.doUnmock("@/lib/check/store"); vi.doUnmock("@/lib/check/run"); vi.doUnmock("@/lib/throttle"); });

const GOOD_HTML = `<!doctype html><html lang="en"><head>
<title>Rao's Bakery — fresh bread in Jayanagar</title>
<meta name="description" content="Sourdough, celebration cakes and pav baked every morning in Jayanagar, Bengaluru. Order ahead or drop in.">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="canonical" href="https://raosbakery.in/">
<meta property="og:title" content="Rao's Bakery"><meta property="og:image" content="https://raosbakery.in/og.png">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Bakery","name":"Rao's"},{"@type":"LocalBusiness","name":"Rao's"}]}</script>
</head><body><h1>Rao's Bakery</h1></body></html>`;

const good: Fetched = {
  finalUrl: "https://raosbakery.in/",
  html: GOOD_HTML,
  robots: "User-agent: *\nAllow: /\nSitemap: https://raosbakery.in/sitemap.xml",
  llms: "# Rao's Bakery\n\n> Fresh bread and cakes in Jayanagar, Bengaluru.",
  sitemap: "<?xml version='1.0'?><urlset><url><loc>https://raosbakery.in/</loc></url></urlset>",
};

describe("the checks", () => {
  it("are worth 100 points, 50 for search and 50 for AI readiness", () => {
    const checks = runChecks(good);
    const sum = (g: string) => checks.filter((c) => c.group === g).reduce((n, c) => n + c.points, 0);
    expect(sum("search")).toBe(50);
    expect(sum("ai")).toBe(50);
    expect(new Set(checks.map((c) => c.id)).size).toBe(checks.length);
  });

  it("a site that does everything scores 100, grade A", () => {
    const r = scoreChecks("raosbakery.in", good.finalUrl, runChecks(good), 0);
    expect(r.checks.filter((c) => !c.passed).map((c) => c.id)).toEqual([]);
    expect(r).toMatchObject({ score: 100, grade: "A", passed: 14, total: 14 });
  });

  it("a bare page fails what it lacks, and says how to fix each", () => {
    const bare: Fetched = { finalUrl: "http://bare.example/", html: "<html><body><h1>a</h1><h1>b</h1></body></html>", robots: null, llms: null, sitemap: null };
    const r = scoreChecks("bare.example", bare.finalUrl, runChecks(bare), 0);
    const failed = r.checks.filter((c) => !c.passed);
    expect(failed.map((c) => c.id).sort()).toEqual(["business", "canonical", "description", "h1", "https", "jsonld", "lang", "llms", "og", "sitemap", "title", "viewport"].sort());
    expect(r.score).toBe(15); // crawlable (5) + AI crawlers allowed (10)
    expect(r.grade).toBe("E");
    for (const c of failed) expect(c.fix.length).toBeGreaterThan(20);
  });

  it("doesn't count a single-page app's catch-all HTML as an llms.txt or sitemap", () => {
    const spa = { ...good, llms: "<!DOCTYPE html><html><body>app</body></html>", sitemap: "<!doctype html><html></html>", robots: null };
    const ids = runChecks(spa).filter((c) => !c.passed).map((c) => c.id);
    expect(ids).toContain("llms");
    expect(ids).toContain("sitemap");
  });

  it("reads minified HTML with unquoted attributes (example.com, as served)", () => {
    const html = `<!doctype html><html lang=en><head><meta charset=utf-8><link rel=icon href=data:,><meta name=viewport content="width=device-width,initial-scale=1"><title>Example Domain</title><link rel=canonical href=https://example.com/><meta property=og:title content=Example><script type=application/ld+json>{"@type":"Organization"}</script></head><body><p>x</p></body></html>`;
    const p = readHtml(html);
    expect(p).toMatchObject({ title: "Example Domain", viewport: true, lang: "en", canonical: true, ogTitle: "Example", ldTypes: ["Organization"], h1Count: 0 });
  });

  it("reads JSON-LD types from @graph and arrays, and ignores broken JSON", () => {
    const html = `<script type="application/ld+json">[{"@type":["Organization","Brand"]}]</script><script type="application/ld+json">{oops</script>`;
    expect(readHtml(html).ldTypes).toEqual(["Organization", "Brand"]);
  });
});

describe("robots.txt", () => {
  it("knows when a crawler is shut out of the whole site", () => {
    const r = "User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin\n";
    expect(blocksWholeSite(r, "GPTBot")).toBe(true);
    expect(blocksWholeSite(r, "ClaudeBot")).toBe(false);
    expect(blocksWholeSite("User-agent: *\nDisallow: /", "Googlebot")).toBe(true);
    expect(blocksWholeSite("User-agent: *\nDisallow: /\nAllow: /", "Googlebot")).toBe(false);
    // A crawler's own group replaces the * group.
    expect(blocksWholeSite("User-agent: *\nDisallow: /\n\nUser-agent: PerplexityBot\nAllow: /", "PerplexityBot")).toBe(false);
    expect(blocksWholeSite("# comment\nUser-agent: ClaudeBot # inline\nUser-agent: GPTBot\nDisallow: / # all", "ClaudeBot")).toBe(true);
    expect(blocksWholeSite(null, "GPTBot")).toBe(false);
  });

  it("marks the AI crawlers check failed, naming who is blocked", () => {
    const c = runChecks({ ...good, robots: "User-agent: GPTBot\nDisallow: /\nUser-agent: ClaudeBot\nDisallow: /" }).find((x) => x.id === "ai-crawlers")!;
    expect(c.passed).toBe(false);
    expect(c.detail).toContain("GPTBot, ClaudeBot");
  });
});

describe("which addresses can be checked", () => {
  it("takes a bare domain or a URL, and keeps only the site", () => {
    expect(siteFrom("Example.com")).toEqual({ domain: "example.com", url: "https://example.com/" });
    expect(siteFrom("https://www.example.co.in/about?x=1")).toEqual({ domain: "example.co.in", url: "https://www.example.co.in/" });
  });

  it("refuses anything that isn't a public website name", () => {
    for (const bad of ["", "localhost", "http://127.0.0.1", "10.0.0.1", "javascript:alert(1)", "ftp://example.com", "exa mple.com", "https://"]) {
      expect(siteFrom(bad), bad).toBeNull();
    }
  });
});

describe("checkSite", () => {
  const fake = (pages: Record<string, { status: number; text: string; url?: string }>) =>
    (async (url: string) => {
      const p = pages[url];
      if (!p) throw new Error("unreachable");
      return { url: p.url ?? url, status: p.status, text: p.text };
    }) as never;

  it("follows the home page's final address and reads the side files from there", async () => {
    const r = await checkSite({ domain: "raosbakery.in", url: "https://raosbakery.in/" }, {
      now: 5,
      fetch: fake({
        "https://raosbakery.in/": { status: 200, text: GOOD_HTML, url: "https://www.raosbakery.in/" },
        "https://www.raosbakery.in/robots.txt": { status: 200, text: good.robots! },
        "https://www.raosbakery.in/llms.txt": { status: 200, text: good.llms! },
        "https://www.raosbakery.in/sitemap.xml": { status: 200, text: good.sitemap! },
      }),
    });
    expect(r).toMatchObject({ domain: "raosbakery.in", url: "https://www.raosbakery.in/", score: 100, checkedAt: 5 });
  });

  it("says plainly when the site can't be reached or errors", async () => {
    await expect(checkSite({ domain: "gone.example", url: "https://gone.example/" }, { fetch: fake({}) })).rejects.toBeInstanceOf(CheckFetchError);
    await expect(checkSite({ domain: "err.example", url: "https://err.example/" }, { fetch: fake({ "https://err.example/": { status: 500, text: "x" } }) })).rejects.toThrow(/HTTP 500/);
  });
});

describe("POST /api/check", () => {
  const post = (url: unknown, ip = "203.0.113.200") => new NextRequest("http://x/api/check", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ url }) });

  it("rejects an address that isn't a public website", async () => {
    const { POST } = await import("@/app/api/check/route");
    const r = await POST(post("http://localhost:3000"));
    expect(r.status).toBe(400);
  });

  it("reuses a result from the last half hour instead of fetching the site again", async () => {
    const store = new InMemoryCheckStore();
    await store.save(scoreChecks("raosbakery.in", "https://raosbakery.in/", runChecks(good), Date.now() - 60_000));
    const checkSiteSpy = vi.fn();
    vi.doMock("@/lib/check/store", async (orig) => ({ ...(await orig<object>()), checkStore: () => store }));
    vi.doMock("@/lib/check/run", async (orig) => ({ ...(await orig<object>()), checkSite: checkSiteSpy }));
    const { POST } = await import("@/app/api/check/route");
    const r = await POST(post("raosbakery.in"));
    expect(r.status).toBe(200);
    expect((await r.json()).cached).toBe(true);
    expect(checkSiteSpy).not.toHaveBeenCalled();
  });

  it("limits each visitor to ten fresh checks per ten minutes", async () => {
    const store = new InMemoryCheckStore();
    vi.doMock("@/lib/check/store", async (orig) => ({ ...(await orig<object>()), checkStore: () => store }));
    vi.doMock("@/lib/check/run", async (orig) => ({ ...(await orig<object>()), checkSite: async (s: { domain: string; url: string }) => scoreChecks(s.domain, s.url, runChecks(good), Date.now()) }));
    const { POST } = await import("@/app/api/check/route");
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await POST(post(`site${i}.example`, "203.0.113.201"))).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe("the badge", () => {
  it("shows the stored score, escaped, as SVG", async () => {
    const store = new InMemoryCheckStore();
    await store.save(scoreChecks("raosbakery.in", "https://raosbakery.in/", runChecks(good), 1));
    vi.doMock("@/lib/check/store", async (orig) => ({ ...(await orig<object>()), checkStore: () => store }));
    const { GET } = await import("@/app/check/[domain]/badge.svg/route");
    const r = await GET(new NextRequest("http://x/check/raosbakery.in/badge.svg"), { params: Promise.resolve({ domain: "raosbakery.in" }) });
    expect(r.headers.get("content-type")).toContain("image/svg+xml");
    const svg = await r.text();
    expect(svg).toContain("100/100");
    expect(svg).toContain("SEO &amp; AI ready");
    const none = await GET(new NextRequest("http://x/check/x/badge.svg"), { params: Promise.resolve({ domain: "<script>.example" }) });
    expect(await none.text()).toContain("not checked");
  });
});
