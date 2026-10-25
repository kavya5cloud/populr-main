import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseRobots, reportFor, verdictFor } from "@/lib/tools/robots";
import { buildLlmsTxt, cleanTitle, generateLlmsTxt, linksOn, pickPages, readSitemap, siteNameFrom } from "@/lib/tools/llms-txt";
import { approxWidth, descriptionAdvice, fitToWidth, TITLE, titleAdvice } from "@/lib/tools/serp";
import { FREE_TOOLS, toolPath } from "@/lib/tools/catalog";
import { PUBLIC_ROUTES } from "@/lib/seo";

const root = path.resolve(__dirname, "..");

describe("robots.txt, read the way crawlers read it", () => {
  const robots = `
User-agent: *
Disallow: /admin
Allow: /admin/public

# Training crawlers out, everything else in
User-agent: GPTBot
user-agent: ClaudeBot
Disallow: /

User-agent: PerplexityBot
Disallow: /*.pdf$
Disallow:
`;
  const groups = parseRobots(robots);

  it("a crawler named in a group obeys that group, and only that group", () => {
    expect(verdictFor(groups, "GPTBot", "/").allowed).toBe(false);
    expect(verdictFor(groups, "claudebot", "/menu").allowed).toBe(false);
    // Named, so the * group's /admin rule doesn't apply to it.
    expect(verdictFor(groups, "PerplexityBot", "/admin").allowed).toBe(true);
    expect(verdictFor(groups, "PerplexityBot", "/admin").matchedBy).toBe("PerplexityBot");
  });

  it("everyone else falls back to the * group", () => {
    const v = verdictFor(groups, "OAI-SearchBot", "/admin/settings");
    expect(v).toEqual({ allowed: false, rule: "Disallow: /admin", matchedBy: "*" });
  });

  it("the longest matching rule wins, and Allow wins a tie", () => {
    expect(verdictFor(groups, "Googlebot", "/admin/public/page").allowed).toBe(true);
    const tie = parseRobots("User-agent: *\nDisallow: /a\nAllow: /a");
    expect(verdictFor(tie, "x", "/a").allowed).toBe(true);
  });

  it("understands * and $, and ignores an empty Disallow", () => {
    expect(verdictFor(groups, "PerplexityBot", "/menu.pdf").allowed).toBe(false);
    expect(verdictFor(groups, "PerplexityBot", "/menu.pdf?x=1").allowed).toBe(true);
    expect(verdictFor(groups, "PerplexityBot", "/").rule).toBeNull();
  });

  it("no group at all means no rules", () => {
    expect(verdictFor(parseRobots("User-agent: GPTBot\nDisallow: /"), "ClaudeBot", "/")).toEqual({ allowed: true, rule: null, matchedBy: null });
  });

  it("follows RFC 9309 on errors: 404 allows everything, 5xx or no answer blocks everything", () => {
    expect(reportFor("https://x.in", { status: 404, text: "" }).crawlers.every((c) => c.allowed)).toBe(true);
    expect(reportFor("https://x.in", { status: 404, text: "" }).file).toBe("missing");
    expect(reportFor("https://x.in", { status: 503, text: "" }).crawlers.every((c) => !c.allowed)).toBe(true);
    expect(reportFor("https://x.in", null).file).toBe("unreachable");
  });

  it("separates crawlers that find pages for answers from ones that collect training data", () => {
    const r = reportFor("https://x.in", { status: 200, text: robots });
    const kind = (a: string) => r.crawlers.find((c) => c.agent === a)?.kind;
    expect(kind("OAI-SearchBot")).toBe("answers");
    expect(kind("GPTBot")).toBe("training");
    expect(kind("Googlebot")).toBe("search");
    expect(r.crawlers.find((c) => c.agent === "OAI-SearchBot")?.allowed).toBe(true);
  });
});

describe("the llms.txt generator", () => {
  it("reads sitemaps and sitemap indexes", () => {
    expect(readSitemap(`<urlset><url><loc> https://a.in/x </loc></url><url><loc>https://a.in/y?a=1&amp;b=2</loc></url></urlset>`)).toEqual({ urls: ["https://a.in/x", "https://a.in/y?a=1&b=2"], isIndex: false });
    expect(readSitemap(`<sitemapindex><sitemap><loc>https://a.in/s1.xml</loc></sitemap></sitemapindex>`).isIndex).toBe(true);
  });

  it("keeps this site's real pages, shallow ones first, and drops archives, assets and other sites", () => {
    const urls = ["https://www.a.in/blog/post-one", "https://a.in/about", "https://a.in/", "https://other.in/x", "https://a.in/tag/news", "https://a.in/logo.png", "https://a.in/menu?x=1", "https://a.in/about/", "https://a.in/contact"];
    expect(pickPages("https://a.in", urls)).toEqual(["https://a.in/about", "https://a.in/contact", "https://a.in/blog/post-one"]);
    expect(pickPages("https://a.in", urls, 1)).toEqual(["https://a.in/about"]);
  });

  it("finds links on a page when there's no sitemap", () => {
    expect(linksOn(`<a href="/menu">Menu</a><a class="x" href='https://a.in/visit'>`, "https://a.in")).toEqual(["https://a.in/menu", "https://a.in/visit"]);
  });

  it("names the site from og:site_name, or the brand part of the home title", () => {
    expect(siteNameFrom(`<meta property="og:site_name" content="Rao's Bakery">`, "https://a.in")).toBe("Rao's Bakery");
    expect(siteNameFrom(`<title>Home | Rao's Bakery</title>`, "https://a.in")).toBe("Rao's Bakery");
    expect(siteNameFrom(`<title>Fresh bread and cakes in Pune — Rao's</title>`, "https://a.in")).toBe("Rao's");
    expect(siteNameFrom(``, "https://www.a.in")).toBe("a.in");
  });

  it("drops the brand every title repeats", () => {
    expect(cleanTitle("Menu | Rao's Bakery", "Rao's Bakery")).toBe("Menu");
    expect(cleanTitle("Rao's Bakery", "Rao's Bakery")).toBe("Rao's Bakery");
    expect(cleanTitle(null, "x")).toBeNull();
  });

  it("follows llmstxt.org: H1 name, blockquote summary, H2 sections of links", () => {
    const txt = buildLlmsTxt({ name: "Rao's Bakery", summary: "Fresh bread in Pune." }, [
      { url: "https://a.in/menu", title: "Menu | Rao's Bakery", description: "Breads and cakes" },
      { url: "https://a.in/blog/a", title: "Sourdough", description: null },
      { url: "https://a.in/blog/b", title: null, description: null },
      { url: "https://a.in/team/lead", title: "Our baker", description: null },
    ]);
    expect(txt).toBe([
      "# Rao's Bakery", "", "> Fresh bread in Pune.", "",
      "## Pages", "", "- [Menu](https://a.in/menu): Breads and cakes", "- [Our baker](https://a.in/team/lead)", "",
      "## Blog", "", "- [Sourdough](https://a.in/blog/a)", "- [b](https://a.in/blog/b)", "",
    ].join("\n"));
  });

  it("builds from a live site: sitemap index followed, pages read for their own titles", async () => {
    const pages: Record<string, string> = {
      "https://a.in/": `<html><head><title>Home | Rao's Bakery</title><meta name="description" content="Fresh bread in Pune."></head></html>`,
      "https://a.in/robots.txt": "User-agent: *\nAllow: /\nSitemap: https://a.in/sitemap_index.xml\nSitemap: https://evil.example/s.xml",
      "https://a.in/sitemap_index.xml": `<sitemapindex><sitemap><loc>https://a.in/pages.xml</loc></sitemap></sitemapindex>`,
      "https://a.in/pages.xml": `<urlset><url><loc>https://a.in/menu</loc></url><url><loc>https://a.in/visit</loc></url></urlset>`,
      "https://a.in/menu": `<title>Menu | Rao's Bakery</title><meta name="description" content="Breads, cakes and pastries.">`,
    };
    const asked: string[] = [];
    const fetch = (async (u: string) => {
      asked.push(u);
      return pages[u] !== undefined ? { url: u, status: 200, text: pages[u] } : { url: u, status: 404, text: "" };
    }) as never;
    const r = await generateLlmsTxt("https://a.in/", { fetch });
    expect(r.source).toBe("sitemap");
    expect(r.content).toContain("# Rao's Bakery\n\n> Fresh bread in Pune.");
    expect(r.content).toContain("- [Menu](https://a.in/menu): Breads, cakes and pastries.");
    expect(r.content).toContain("- [visit](https://a.in/visit)");
    // A sitemap robots.txt names on another site is never fetched.
    expect(asked).not.toContain("https://evil.example/s.xml");
  });

  it("falls back to the home page's links, and fails clearly when the site can't be reached", async () => {
    const fetch = (async (u: string) => (u === "https://a.in/" ? { url: u, status: 200, text: `<title>A</title><a href="/about">About</a>` } : { url: u, status: 404, text: "" })) as never;
    const r = await generateLlmsTxt("https://a.in/", { fetch });
    expect(r.source).toBe("links");
    expect(r.content).toContain("https://a.in/about");
    const down = (async () => { throw new Error("nope"); }) as never;
    await expect(generateLlmsTxt("https://a.in/", { fetch: down })).rejects.toThrow(/Couldn't load/);
  });
});

describe("the result preview", () => {
  const measure = (t: string) => approxWidth(t, TITLE.sizePx);

  it("measures width, so wide letters run out sooner than narrow ones", () => {
    expect(approxWidth("WWWWWWWWWW", 20)).toBeGreaterThan(approxWidth("iiiiiiiiii", 20) * 2);
  });

  it("leaves a title that fits alone, and cuts one that doesn't at a word, with an ellipsis", () => {
    expect(fitToWidth("Custom cakes in Pune", TITLE.maxPx, measure)).toMatchObject({ shown: "Custom cakes in Pune", truncated: false });
    const long = "Custom birthday cakes, wedding cakes and sourdough bread baked fresh every morning in Koregaon Park";
    const cut = fitToWidth(long, TITLE.maxPx, measure);
    expect(cut.truncated).toBe(true);
    expect(cut.shown.endsWith(" …")).toBe(true);
    expect(long.startsWith(cut.shown.slice(0, -2))).toBe(true);
    expect(measure(cut.shown)).toBeLessThanOrEqual(TITLE.maxPx);
  });

  it("gives advice a person can act on", () => {
    expect(titleAdvice("", 0)[0].level).toBe("bad");
    expect(titleAdvice("Home | Rao's Bakery and Café in Koregaon Park", 400).some((a) => /Starts with "Home"/.test(a.text))).toBe(true);
    expect(titleAdvice("Custom birthday cakes in Koregaon Park, Pune", 420)[0].level).toBe("good");
    expect(descriptionAdvice("Welcome to our website, where you will find all kinds of cakes and breads for any occasion.", 600).some((a) => /Welcome to/.test(a.text))).toBe(true);
  });
});

describe("the free tools on the site", () => {
  const sitemapRoutes = PUBLIC_ROUTES.map((r) => r.path);
  const home = readFileSync(path.join(root, "app/page.tsx"), "utf8");
  const check = readFileSync(path.join(root, "app/check/page.tsx"), "utf8");
  const llms = readFileSync(path.join(root, "app/llms.txt/route.ts"), "utf8");

  it("every tool has a page, is in the sitemap, and has a title and description that fit in a result", () => {
    expect(sitemapRoutes).toContain("/tools");
    for (const t of FREE_TOOLS) {
      expect(existsSync(path.join(root, "app", toolPath(t.slug), "page.tsx"))).toBe(true);
      expect(sitemapRoutes).toContain(toolPath(t.slug));
      // " — Populr" is added to every title.
      expect(t.title.length + " — Populr".length).toBeLessThanOrEqual(60);
      expect(t.description.length).toBeGreaterThanOrEqual(130);
      expect(t.description.length).toBeLessThanOrEqual(160);
    }
  });

  it("is linked from the home page and /check, and listed in Populr's own llms.txt", () => {
    expect(home).toContain('href="/tools"');
    expect(check).toContain('href="/tools"');
    expect(llms).toContain("FREE_TOOLS");
  });
});
