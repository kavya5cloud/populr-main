import { describe, expect, it } from "vitest";
import { pageIssues, readPageFacts, siteIssues, sitemapUrls } from "@/lib/site-audit/audit";

// The audit that keeps trypopulr.in an example of good SEO. Its rules are tested here; the
// GitHub workflow runs them against the live site.

const good = (path: string, extra = "") => `<!doctype html><html lang="en"><head>
<title>Custom cakes in Koregaon Park, Pune — Rao's</title>
<meta name="description" content="Order birthday and wedding cakes baked fresh every morning in Koregaon Park, with same-day pickup and delivery within 5 km.">
<meta name="viewport" content="width=device-width">
<link rel="canonical" href="https://x.in${path}">
<meta property="og:title" content="Cakes"><meta property="og:description" content="Cakes"><meta property="og:image" content="https://x.in/og.png">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization"},{"@type":"WebSite"}]}</script>
${extra}</head><body><h1>Cakes</h1><a href="/menu">Menu</a><a href="https://other.in/x">x</a><a href="#top">top</a><a href="mailto:a@b.c">mail</a><img src="a.png" alt=""></body></html>`;

describe("reading a page", () => {
  it("collects what search engines read", () => {
    const f = readPageFacts(good("/"), "https://x.in/");
    expect(f).toMatchObject({ lang: "en", h1Count: 1, viewport: true, canonical: "https://x.in/", twitterCard: "summary_large_image", imagesWithoutAlt: 0 });
    expect(f.jsonld).toEqual([{ ok: true, types: ["Organization", "WebSite"] }]);
    expect(f.links).toEqual(["https://x.in/menu"]);
  });

  it("finds nothing wrong with a good page", () => {
    expect(pageIssues(readPageFacts(good("/"), "https://x.in/"))).toEqual([]);
  });
});

describe("what it flags", () => {
  const issues = (html: string, url = "https://x.in/a") => pageIssues(readPageFacts(html, url)).map((i) => `${i.level}:${i.check}`);

  it("a canonical pointing elsewhere, and noindex on a sitemap page", () => {
    expect(issues(good("/b"))).toContain("error:canonical");
    expect(issues(good("/a", '<meta name="robots" content="noindex, follow">'))).toContain("error:robots");
  });

  it("missing basics", () => {
    const bare = "<html><head></head><body><img src=x></body></html>";
    expect(issues(bare)).toEqual(expect.arrayContaining(["error:lang", "error:viewport", "error:title", "error:description", "error:canonical", "error:h1", "warning:open-graph", "warning:structured-data", "warning:img-alt"]));
  });

  it("structured data that doesn't parse", () => {
    expect(issues(good("/a", '<script type="application/ld+json">{oops</script>'))).toContain("error:structured-data");
  });

  it("a title Google will cut, and a description of the wrong length", () => {
    const long = good("/a").replace(/<title>.*<\/title>/, "<title>Custom birthday cakes, wedding cakes and sourdough bread in Koregaon Park, Pune — Rao's Bakery</title>").replace(/content="Order[^"]*"/, 'content="Cakes."');
    expect(issues(long)).toEqual(expect.arrayContaining(["warning:title", "warning:description"]));
  });
});

describe("across pages", () => {
  it("duplicate titles and descriptions", () => {
    const a = readPageFacts(good("/a"), "https://x.in/a"), b = readPageFacts(good("/b"), "https://x.in/b");
    const found = siteIssues([a, b]).map((i) => i.check);
    expect(found).toEqual(expect.arrayContaining(["duplicate-title", "duplicate-description"]));
  });

  it("a language alternate that doesn't link back", () => {
    const en = readPageFacts(good("/", '<link rel="alternate" hreflang="hi" href="https://x.in/hi"><link rel="alternate" hreflang="x-default" href="https://x.in/">').replace("Custom cakes", "One"), "https://x.in/");
    const hi = readPageFacts(good("/hi").replace("Custom cakes", "Two").replace("Order birthday", "Hindi"), "https://x.in/hi");
    expect(siteIssues([en, hi]).filter((i) => i.check === "hreflang")).toHaveLength(1);
  });

  it("reads sitemap URLs", () => {
    expect(sitemapUrls("<urlset><url><loc>https://x.in</loc></url><url><loc> https://x.in/a?b=1&amp;c=2 </loc></url></urlset>")).toEqual(["https://x.in", "https://x.in/a?b=1&c=2"]);
  });
});
