import { describe, expect, it } from "vitest";
import { approvedFixes, buildJsonLd, jsonForJs, pagePath, renderSnippet, type AutopilotConfig } from "@/lib/seo/autopilot";
import { InMemoryAutopilotStore } from "@/lib/seo/autopilot-store";
import { readPage, suggestFix } from "@/lib/seo/autopilot-suggest";
import robots from "@/app/robots";

// The SEO autopilot changes what search engines read about a customer's business, under
// their name. These pin what it must never do: invent a detail, apply something unapproved,
// run on someone else's domain, or be blocked from the crawler that has to execute it.
//
// Verified in a real browser before these were written: on a stand-in customer page the
// snippet replaced the title, added the description and injected Store + WebSite markup, the
// install beacon recorded the page, and a draft for a real public page came back grounded
// and within length.

const base = (over: Partial<AutopilotConfig> = {}): AutopilotConfig => ({
  workspace: "w", siteKey: "abcdef123", site: "https://kiranaexpress.in", enabled: true,
  business: { type: "Store", name: "Kirana Express", description: "Groceries in Pune", address: { locality: "Pune", country: "IN" } },
  faq: [{ q: "Do you deliver to Baner?", a: "Yes, within 3 km." }],
  pages: {}, seen: { count: 0, lastAt: null, lastPath: null, paths: [] }, ...over,
});

describe("structured data is built only from what the founder typed", () => {
  it("leaves out every field that was left empty, rather than guessing", () => {
    const [entity] = buildJsonLd(base(), "/");
    expect(entity).toMatchObject({ "@type": "Store", name: "Kirana Express", url: "https://kiranaexpress.in" });
    expect(entity).not.toHaveProperty("telephone");
    expect(entity).not.toHaveProperty("openingHours");
    expect(entity.address).toEqual({ "@type": "PostalAddress", addressLocality: "Pune", addressCountry: "IN" });
  });

  it("produces nothing at all without a business name", () => {
    expect(buildJsonLd(base({ business: { type: "Store", name: "  " } }), "/")).toEqual([]);
  });

  it("puts FAQs on the homepage only — the same markup on every page is spam", () => {
    expect(buildJsonLd(base(), "/").some((j) => j["@type"] === "FAQPage")).toBe(true);
    expect(buildJsonLd(base(), "/about").some((j) => j["@type"] === "FAQPage")).toBe(false);
  });

  it("drops profile links that aren't web addresses", () => {
    const [e] = buildJsonLd(base({ business: { type: "Store", name: "K", sameAs: ["https://instagram.com/k", "javascript:alert(1)", "not a url"] } }), "/");
    expect(e.sameAs).toEqual(["https://instagram.com/k"]);
  });
});

describe("only approved fixes reach the site", () => {
  it("a suggestion waiting for the founder changes nothing", () => {
    const fixes = approvedFixes(base({ pages: { "/about": { title: "Draft", description: "Draft desc", status: "suggested", at: 0 } } }));
    expect(fixes["/about"].title).toBeUndefined();
    expect(fixes["/about"].description).toBeUndefined();
  });

  it("an approved one does", () => {
    const fixes = approvedFixes(base({ pages: { "/about": { title: "About us", description: "Who we are", status: "approved", at: 0 } } }));
    expect(fixes["/about"]).toMatchObject({ title: "About us", description: "Who we are" });
  });

  it("a switched-off site gets a snippet that does nothing", () => {
    expect(renderSnippet(base({ enabled: false }), "https://www.trypopulr.in")).not.toMatch(/document\./);
  });
});

describe("the snippet", () => {
  const js = renderSnippet(base({ business: { type: "Store", name: "A </script><script>alert(1)</script>" } }), "https://www.trypopulr.in");

  it("runs only on the registered domain", () => {
    expect(js).toContain('var H="kiranaexpress.in"');
    expect(js).toMatch(/if\(location\.hostname\.replace\(\/\^www\\\.\/,""\)!==H\)return;/);
  });

  it("can't be broken out of by a business description", () => {
    expect(js).not.toContain("</script>");
    expect(jsonForJs({ s: "a b" })).toBe('{"s":"a\\u2028b"}');
  });

  it("is valid JavaScript", () => {
    expect(() => new Function(js)).not.toThrow();
  });

  it("never adds a second copy of markup the page already has", () => {
    expect(js).toContain("if(have[j[\"@type\"]])return;");
  });
});

describe("crawlers must be able to fetch it", () => {
  it("is not blocked by robots.txt — Google has to load the script to see the fixes", () => {
    const rules = robots().rules;
    const disallow = (Array.isArray(rules) ? rules : [rules]).flatMap((r) => [r.disallow ?? []].flat());
    expect(disallow.some((d) => "/s/abc.js".startsWith(d.replace(/\*$/, "")) && d !== "/")).toBe(false);
  });
});

describe("drafting a page's title and description", () => {
  const html = `<html><head><title>Home</title></head><body><nav>menu</nav><h1>Kirana Express</h1><p>Fresh groceries from your neighbourhood store in Pune, delivered the same day. Vegetables, dairy and daily essentials.</p></body></html>`;

  it("reads the page, skipping navigation", () => {
    const p = readPage(html);
    expect(p).toMatchObject({ title: "Home", description: null, h1: "Kirana Express" });
    expect(p.text).not.toContain("menu");
  });

  it("discards a draft with a number the page doesn't contain", async () => {
    process.env.GROQ_API_KEY = "gsk_test";
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: '{"title":"Pune\'s #1 grocery store | Kirana Express","description":"Rated 4.9 by 2,000 customers. Fresh groceries from your neighbourhood store in Pune, delivered the same day."}' } }] }))) as typeof fetch;
    try {
      const r = await suggestFix("https://kiranaexpress.in", "/", "Kirana Express", { fetchPage: async () => html });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/number that isn't on the page/);
    } finally { globalThis.fetch = origFetch; delete process.env.GROQ_API_KEY; }
  });
});

describe("paths and the install beacon", () => {
  it("treats /About/, /about and /about?x=1 as one page", () => {
    for (const p of ["/About/", "/about", "/about?x=1", "about#top"]) expect(pagePath(p), p).toBe("/about");
    expect(pagePath("")).toBe("/");
  });

  it("records where the snippet ran, without growing forever", async () => {
    const store = new InMemoryAutopilotStore();
    const c = await store.save({ workspace: "w", site: "https://k.in", enabled: true, business: null, faq: [], pages: {} });
    for (let i = 0; i < 60; i++) await store.seen(c.siteKey, `/p${i}`, i);
    const after = (await store.get("w"))!;
    expect(after.seen.count).toBe(60);
    expect(after.seen.paths.length).toBe(50);
  });

  it("keeps the site key when settings change, so the pasted tag keeps working", async () => {
    const store = new InMemoryAutopilotStore();
    const a = await store.save({ workspace: "w", site: "https://k.in", enabled: false, business: null, faq: [], pages: {} });
    const b = await store.save({ workspace: "w", site: "https://k.in", enabled: true, business: null, faq: [], pages: {} });
    expect(b.siteKey).toBe(a.siteKey);
  });
});
