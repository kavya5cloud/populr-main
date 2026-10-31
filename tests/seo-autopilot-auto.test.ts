import { describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { AUTO_PER_DAY, autoFixNewPage, autoFixPage, internalPaths, MAX_PAGES, turnOn } from "@/lib/seo/autopilot-auto";
import { InMemoryAutopilotStore, NeonAutopilotStore } from "@/lib/seo/autopilot-store";
import { needsFix, pageUrl, readPage } from "@/lib/seo/autopilot-suggest";
import { approvedFixes, type PageFix } from "@/lib/seo/autopilot";
import { handle } from "@/lib/mcp/server";

// Automatic mode — turning Populr on from an editor. Turning it on is the approval, so what
// these pin down is everything that still holds without one: only broken titles and
// descriptions are touched, only from the page itself, never a page someone undid, and the
// public beacon can't spend unbounded work on a site.

const SITE = "https://shop.example";
const page = (title: string, description = "", extra = "") =>
  `<html><head><title>${title}</title>${description ? `<meta name="description" content="${description}">` : ""}${extra}</head><body><h1>${title}</h1><p>${"Fresh groceries delivered across Pune every morning. ".repeat(4)}</p></body></html>`;
const GOOD_TITLE = "Fresh groceries delivered in Pune — Shop A";
const GOOD_DESC = "Order fresh fruit, vegetables and staples from Shop A in Pune, delivered to your door every morning before nine.";
const suggest = vi.fn(async () => ({ ok: true as const, fix: { title: "Shop A — fresh groceries delivered in Pune", description: "Order fresh groceries from Shop A in Pune: fruit, vegetables and staples, delivered to your door every morning.", status: "suggested" as const, before: { title: "Shop", description: null }, at: 0 } }));
const fetchFrom = (pages: Record<string, string | { status: number; url?: string }>) => async (url: string) => {
  const p = pages[new URL(url).pathname];
  if (p === undefined) return { status: 404, text: "" };
  return typeof p === "string" ? { status: 200, text: p, url } : { status: p.status, text: "", url: p.url ?? url };
};

describe("what counts as broken", () => {
  it("leaves a good title and description alone", () => {
    expect(needsFix(readPage(page(GOOD_TITLE, GOOD_DESC)))).toBeNull();
  });

  it("names each broken part on its own", () => {
    expect(needsFix(readPage(page("Shop", GOOD_DESC)))).toEqual({ title: "title too short" });
    expect(needsFix(readPage(page(GOOD_TITLE)))).toEqual({ description: "no description" });
    expect(needsFix(readPage(page(GOOD_TITLE, GOOD_DESC)), GOOD_TITLE)).toEqual({ title: "same title as the home page" });
  });

  it("never leaves the site, even for a path that looks like one", () => {
    expect(pageUrl(SITE, "/about")).toBe("https://shop.example/about");
    expect(pageUrl(SITE, "//evil.example/x")).toBeNull();
    expect(pageUrl(SITE, "https://evil.example/")).toBeNull();
  });

  it("finds the pages the navigation leads to, shallowest first, skipping logins, files and other sites", () => {
    const html = `<a href="/blog/2024/post">x</a><a href="/about">x</a><a href="/login">x</a><a href="/menu.pdf">x</a><a href="https://other.example/x">x</a><a href="/about/">x</a><a href="/contact">x</a><a href="#top">x</a><a href="/">x</a>`;
    expect(internalPaths(html, SITE, 10)).toEqual(["/about", "/contact", "/blog/2024/post"]);
    expect(internalPaths(html, SITE, 1)).toEqual(["/about"]);
  });
});

describe("fixing one page", () => {
  const cfg = { site: SITE, business: null };

  it("fixes only the broken part, as approved and marked automatic", async () => {
    const r = await autoFixPage(cfg, "/", { fetch: fetchFrom({ "/": page(GOOD_TITLE) }), suggest, now: () => 5 });
    expect(r.outcome).toBe("fixed");
    if (r.outcome !== "fixed") return;
    expect(r.fix).toMatchObject({ status: "approved", by: "auto", at: 5 });
    expect(r.fix.title).toBeUndefined();
    expect(r.fix.description).toMatch(/Pune/);
  });

  it("leaves fine pages, noindex pages, errors and redirects off the site", async () => {
    const pages = { "/": page(GOOD_TITLE, GOOD_DESC), "/private": page("x", "", '<meta name="robots" content="noindex">'), "/moved": { status: 200, url: "https://elsewhere.example/" } };
    const deps = { fetch: fetchFrom(pages), suggest };
    expect((await autoFixPage(cfg, "/", deps)).outcome).toBe("fine");
    expect(await autoFixPage(cfg, "/private", deps)).toMatchObject({ outcome: "skipped", reason: expect.stringMatching(/not to index/) });
    expect(await autoFixPage(cfg, "/gone", deps)).toMatchObject({ outcome: "skipped", reason: "the page answered 404" });
    expect(await autoFixPage(cfg, "/moved", deps)).toMatchObject({ outcome: "skipped", reason: expect.stringMatching(/off the site/) });
  });
});

describe("turning Populr on", () => {
  const home = page("Shop", GOOD_DESC, "") + `<a href="/about">a</a><a href="/contact">c</a>`;

  it("switches on the snippet and automatic mode, approves waiting drafts, and fixes the main pages", async () => {
    const store = new InMemoryAutopilotStore();
    await store.save({ workspace: "w", site: SITE, enabled: false, business: null, faq: [], pages: { "/pricing": { title: "t", description: "d", status: "suggested", at: 0 } } });
    const r = await turnOn(store, "w", { site: SITE, business: { type: "Store", name: "Shop A" } }, { fetch: fetchFrom({ "/": home, "/about": page(GOOD_TITLE, GOOD_DESC), "/contact": page("Contact") }), suggest });
    expect(r.status).toBe("on");
    if (r.status !== "on") return;
    expect(r.config).toMatchObject({ enabled: true, auto: true, business: { name: "Shop A" } });
    expect(r.approvedDrafts).toEqual(["/pricing"]);
    expect(r.config.pages["/pricing"].status).toBe("approved");
    expect(Object.fromEntries(r.results.map((x) => [x.path, x.outcome]))).toEqual({ "/": "fixed", "/about": "fine", "/contact": "fixed" });
    // Live through the snippet straight away, because turning it on was the approval.
    expect(Object.keys(approvedFixes(r.config))).toEqual(expect.arrayContaining(["/", "/contact", "/pricing"]));
  });

  it("never replaces a fix that already exists", async () => {
    const store = new InMemoryAutopilotStore();
    const mine: PageFix = { title: "My own title, written by hand", status: "approved", at: 1 };
    await store.save({ workspace: "w", site: SITE, enabled: true, business: null, faq: [], pages: { "/": mine } });
    const r = await turnOn(store, "w", { site: SITE, business: null }, { fetch: fetchFrom({ "/": home }), suggest });
    expect(r.status === "on" && r.config.pages["/"]).toEqual(mine);
  });

  it("won't switch a workspace to a different site", async () => {
    const store = new InMemoryAutopilotStore();
    await store.save({ workspace: "w", site: "https://other.example", enabled: true, business: null, faq: [], pages: {} });
    expect(await turnOn(store, "w", { site: SITE, business: null }, { fetch: fetchFrom({}) })).toEqual({ status: "different_site_set_up", site: "https://other.example" });
  });

  it("stops starting new pages once its time is spent — the editor is waiting", async () => {
    let t = 0;
    const r = await turnOn(new InMemoryAutopilotStore(), "w", { site: SITE, business: null }, { fetch: async (u) => { t += 40_000; return fetchFrom({ "/": home, "/about": page("A"), "/contact": page("C") })(u); }, suggest, now: () => t });
    expect(r.status === "on" && r.results.some((x) => x.outcome === "skipped" && /out of time/.test(x.reason))).toBe(true);
  });
});

describe("pages the snippet finds later", () => {
  const setup = async (over: Record<string, unknown> = {}) => {
    const store = new InMemoryAutopilotStore();
    const c = await store.save({ workspace: "w", site: SITE, enabled: true, auto: true, business: null, faq: [], pages: {}, ...over });
    return { store, key: c.siteKey };
  };
  const deps = { fetch: fetchFrom({ "/new": page("New"), "/undone": page("Undone") }), suggest, now: () => Date.parse("2026-10-31T10:00:00Z") };

  it("fixes a new page in automatic mode, and does nothing otherwise", async () => {
    const on = await setup();
    expect((await autoFixNewPage(on.store, on.key, "/new", deps))?.outcome).toBe("fixed");
    expect((await on.store.byKey(on.key))!.pages["/new"].by).toBe("auto");
    const off = await setup({ auto: false });
    expect(await autoFixNewPage(off.store, off.key, "/new", deps)).toBeNull();
  });

  it("never touches a page whose fix was undone", async () => {
    const { store, key } = await setup({ pages: { "/undone": { status: "declined", at: 1 } } });
    expect(await autoFixNewPage(store, key, "/undone", deps)).toBeNull();
    expect(approvedFixes((await store.byKey(key))!)["/undone"].title).toBeUndefined();
  });

  it(`does at most ${AUTO_PER_DAY} a day per site, and stops at ${MAX_PAGES} pages`, async () => {
    const busy = await setup({ autoDay: { day: "2026-10-31", count: AUTO_PER_DAY } });
    expect(await autoFixNewPage(busy.store, busy.key, "/new", deps)).toBeNull();
    const yesterday = await setup({ autoDay: { day: "2026-10-30", count: AUTO_PER_DAY } });
    expect(await autoFixNewPage(yesterday.store, yesterday.key, "/new", deps)).not.toBeNull();
    const full = await setup({ pages: Object.fromEntries(Array.from({ length: MAX_PAGES }, (_, i) => [`/p${i}`, { status: "approved", at: 0 }])) });
    expect(await autoFixNewPage(full.store, full.key, "/new", deps)).toBeNull();
  });
});

describe("the snippet's beacon says when a page is new", () => {
  it("in memory", async () => {
    const store = new InMemoryAutopilotStore();
    const { siteKey } = await store.save({ workspace: "w", site: SITE, enabled: true, business: null, faq: [], pages: {} });
    expect(await store.seen(siteKey, "/a", 1)).toBe(true);
    expect(await store.seen(siteKey, "/A/", 2)).toBe(false);
    expect(await store.seen("nope-key", "/a", 3)).toBe(false);
  });

  it("on real Postgres, where the answer comes from the row as it was before the update", async () => {
    const pg = new PGlite();
    const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) =>
      (await pg.query(strings.reduce((t, part, i) => `${t}$${i}${part}`), values)).rows) as never;
    const store = new NeonAutopilotStore(sql);
    const { siteKey } = await store.save({ workspace: "w", site: SITE, enabled: true, business: null, faq: [], pages: {} });
    expect(await store.seen(siteKey, "/a", 1)).toBe(true);
    expect(await store.seen(siteKey, "/a", 2)).toBe(false);
    expect(await store.seen(siteKey, "/b", 3)).toBe(true);
    expect((await store.byKey(siteKey))!.seen).toMatchObject({ count: 3, paths: ["/a", "/b"], lastPath: "/b" });
  });
});

describe("the turn_on tool", () => {
  const call = (args: Record<string, unknown>) => ({ jsonrpc: "2.0" as const, id: 1, method: "tools/call", params: { name: "turn_on", arguments: args } });
  type Out = { result: { isError: boolean; content: { text: string }[]; structuredContent?: Record<string, unknown> } };

  it("returns everything to write into the code, and says turning it on was the approval", async () => {
    const autopilot = new InMemoryAutopilotStore();
    const r = await handle(call({ site: SITE, business: { name: "Shop A", type: "Store", description: "Fresh groceries in Pune." } }), "ws", { autopilot, fetchPage: async () => page("Shop"), suggest }) as Out;
    const text = r.result.content[0].text;
    expect(r.result.isError).toBe(false);
    expect(text).toMatch(/turned it on, and that approves these changes/);
    expect(text).toMatch(/<script src="[^"]+\/s\/[\w-]+\.js" async><\/script>/);
    const data = r.result.structuredContent!;
    expect(data.status).toBe("on");
    expect((data.pages as { path: string }[]).map((p) => p.path)).toContain("/");
    expect((data.structuredData as { siteWide: { "@type": string }[] }).siteWide.map((j) => j["@type"])).toEqual(["Store", "WebSite"]);
    expect(data.llmsTxt).toMatch(/^# Shop A\n\n> Fresh groceries in Pune\./);
    expect((await autopilot.get("ws"))!.auto).toBe(true);
  });

  it("asks for the address when there's no site yet, and refuses one that isn't a website", async () => {
    const autopilot = new InMemoryAutopilotStore();
    const none = await handle(call({}), "ws", { autopilot }) as Out;
    expect(none.result.structuredContent?.status).toBe("not_set_up");
    const bad = await handle(call({ site: "not a site" }), "ws", { autopilot }) as Out;
    expect(bad.result.isError).toBe(true);
  });
});

describe("undoing an automatic fix from the dashboard", () => {
  it("remembers the undo, so Populr leaves the page as it was", async () => {
    vi.resetModules();
    vi.doMock("@/lib/auth", () => ({ getSession: async () => null }));
    vi.doMock("@/lib/intel", () => ({ workspaceKey: async () => "ws-undo" }));
    const { autopilotStore } = await import("@/lib/seo/autopilot-store");
    const { DELETE } = await import("@/app/api/seo/autopilot/route");
    const { NextRequest } = await import("next/server");
    const store = autopilotStore();
    await store.save({ workspace: "ws-undo", site: SITE, enabled: true, auto: true, business: null, faq: [], pages: { "/a": { description: "auto", status: "approved", by: "auto", at: 1 }, "/b": { title: "x", status: "approved", at: 1 } } });
    const del = (p: string) => DELETE(new NextRequest(`https://x/api/seo/autopilot?wsid=w&path=${p}`, { method: "DELETE", headers: { "x-forwarded-for": "10.9.9.9" } }));
    await del("/a");
    expect((await store.get("ws-undo"))!.pages["/a"].status).toBe("declined");
    await store.save({ ...(await store.get("ws-undo"))!, auto: false });
    await del("/b");
    expect((await store.get("ws-undo"))!.pages["/b"]).toBeUndefined();
    vi.doUnmock("@/lib/auth");
    vi.doUnmock("@/lib/intel");
  });
});

describe("a draft that runs long is cut at a word, never mid-word", () => {
  it("drops a trailing brand first, then cuts at the last whole word", async () => {
    const { fitText } = await import("@/lib/seo/autopilot-suggest");
    expect(fitText("Free Kannada Unicode fonts and Karnataka information | Government of Karnataka", 60)).toBe("Free Kannada Unicode fonts and Karnataka information");
    const cut = fitText("Order sourdough, celebration cakes and pastries baked fresh every morning in Koregaon Park, Pune", 60);
    expect(cut.length).toBeLessThanOrEqual(60);
    expect("Order sourdough, celebration cakes and pastries baked fresh every morning in Koregaon Park, Pune".startsWith(cut)).toBe(true);
    expect(cut).toMatch(/\w$/);
    expect(fitText("Short and fine", 60)).toBe("Short and fine");
  });
});
