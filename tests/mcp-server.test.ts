import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hashKey, InMemoryKeyStore, looksLikeKey } from "@/lib/mcp/keys";
import { handle, SUPPORTED_VERSIONS } from "@/lib/mcp/server";
import { TOOLS } from "@/lib/mcp/tools";
import Ajv from "ajv";
import { InMemoryAutopilotStore } from "@/lib/seo/autopilot-store";

// Populr's MCP server. Verified with the official MCP Inspector before these were written:
// it initialised, listed seven tools and called seo_status, get_seo_fixes and verify_page
// against a real public site. These pin the protocol, the key handling, and the tenant line.

afterEach(() => { vi.resetModules(); vi.doUnmock("@/lib/auth"); vi.doUnmock("@/lib/db"); vi.doUnmock("@/lib/mcp/keys"); vi.doUnmock("@/lib/seo/autopilot-store"); });

async function setup() {
  const autopilot = new InMemoryAutopilotStore();
  await autopilot.save({
    workspace: "ws-a", site: "https://a.example", enabled: true,
    business: { type: "Store", name: "Shop A" }, faq: [],
    pages: { "/": { title: "Shop A — groceries", description: "Fresh groceries from Shop A in Pune, delivered to your door every day of the week.", status: "approved", at: 0 } },
  });
  await autopilot.save({ workspace: "ws-b", site: "https://b.example", enabled: true, business: { type: "Store", name: "Shop B" }, faq: [], pages: {} });
  return { autopilot };
}

const call = (name: string, args: Record<string, unknown> = {}) => ({ jsonrpc: "2.0" as const, id: 1, method: "tools/call", params: { name, arguments: args } });
const text = (r: unknown) => ((r as { result: { content: { text: string }[] } }).result.content[0].text);

describe("the protocol", () => {
  it("negotiates a version it supports, and offers tools", async () => {
    const { autopilot } = await setup();
    const r = await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, "ws-a", { autopilot }) as { result: { protocolVersion: string; capabilities: object; serverInfo: { name: string } } };
    expect(r.result.protocolVersion).toBe("2025-06-18");
    expect(r.result.capabilities).toHaveProperty("tools");
    expect(r.result.serverInfo.name).toBe("populr");
    // An unknown version gets the latest we support, not an error.
    const r2 = await handle({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } }, "ws-a", { autopilot }) as { result: { protocolVersion: string } };
    expect(r2.result.protocolVersion).toBe(SUPPORTED_VERSIONS[0]);
  });

  it("lists tools with schemas, and marks the ones that write", async () => {
    const { autopilot } = await setup();
    const r = await handle({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "ws-a", { autopilot }) as { result: { tools: { name: string; inputSchema: object; annotations: { readOnlyHint: boolean } }[] } };
    const names = r.result.tools.map((t) => t.name);
    expect(names).toEqual(["seo_status", "turn_on", "setup_site", "set_business_details", "get_seo_fixes", "get_structured_data", "audit_page", "draft_page_fix", "approve_page_fix", "generate_llms_txt", "verify_page"]);
    expect(r.result.tools.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name)).toEqual(["turn_on", "setup_site", "set_business_details", "draft_page_fix", "approve_page_fix"]);
  });

  it("rejects unknown methods, unknown tools and missing arguments as protocol errors", async () => {
    const { autopilot } = await setup();
    expect(await handle({ jsonrpc: "2.0", id: 1, method: "sampling/createMessage" }, "ws-a", { autopilot })).toMatchObject({ error: { code: -32601 } });
    expect(await handle(call("drop_database"), "ws-a", { autopilot })).toMatchObject({ error: { code: -32602 } });
    expect(await handle(call("audit_page", {}), "ws-a", { autopilot })).toMatchObject({ error: { code: -32602 } });
  });
});

describe("the tenant line", () => {
  it("a key's workspace is the only one its tools can read", async () => {
    const { autopilot } = await setup();
    const a = text(await handle(call("get_seo_fixes"), "ws-a", { autopilot }));
    const b = text(await handle(call("get_seo_fixes"), "ws-b", { autopilot }));
    expect(a).toContain("Shop A — groceries");
    expect(b).not.toContain("Shop A");
  });

  it("verify_page refuses a site the workspace doesn't manage", async () => {
    const { autopilot } = await setup();
    const r = await handle(call("verify_page", { url: "https://b.example/" }), "ws-a", { autopilot }) as { result: { isError: boolean } };
    expect(r.result.isError).toBe(true);
  });

  it("draft_page_fix never overwrites a fix the owner approved", async () => {
    const { autopilot } = await setup();
    const suggest = vi.fn(async () => ({ ok: true as const, fix: { title: "New", description: "New desc", status: "suggested" as const, at: 1 } }));
    await handle(call("draft_page_fix", { path: "/" }), "ws-a", { autopilot, suggest });
    expect((await autopilot.get("ws-a"))!.pages["/"].status).toBe("approved");
    expect((await autopilot.get("ws-a"))!.pages["/"].title).toBe("Shop A — groceries");
  });
});

describe("the tools", () => {
  it("verify_page reports what is and isn't live", async () => {
    const { autopilot } = await setup();
    const html = `<html><head><title>Shop A — groceries</title><meta name="description" content="old"></head><body><h1>A</h1></body></html>`;
    const t = text(await handle(call("verify_page", { url: "https://a.example/" }), "ws-a", { autopilot, fetchPage: async () => html }));
    expect(t).toMatch(/✓ Title matches/);
    expect(t).toMatch(/✗ Description/);
    expect(t).toMatch(/✗ Structured data Store missing/);
  });

  it("audit_page reads the page's problems", async () => {
    const { autopilot } = await setup();
    const t = text(await handle(call("audit_page", { url: "https://x.example/" }), "ws-a", { autopilot, fetchPage: async () => "<html><head></head><body></body></html>" }));
    expect(t).toMatch(/No title tag/);
  });

  it("generate_llms_txt lists only approved pages", async () => {
    const { autopilot } = await setup();
    const t = text(await handle(call("generate_llms_txt"), "ws-a", { autopilot }));
    expect(t).toContain("# Shop A");
    expect(t).toContain("[Shop A — groceries](https://a.example/)");
  });
});

describe("access keys", () => {
  it("stores only a hash, and resolves only the real key", async () => {
    const s = new InMemoryKeyStore();
    const c = (await s.create("ws-a", "Laptop", 1))!;
    expect(looksLikeKey(c.key)).toBe(true);
    expect(JSON.stringify(await s.list("ws-a"))).not.toContain(c.key);
    expect(await s.resolve(c.key, 2)).toBe("ws-a");
    expect(await s.resolve(c.key.slice(0, -1) + (c.key.endsWith("A") ? "B" : "A"), 2)).toBeNull();
    expect(hashKey(c.key)).toHaveLength(64);
  });

  it("revokes only within its own workspace, and a revoked key stops working", async () => {
    const s = new InMemoryKeyStore();
    const c = (await s.create("ws-a", "x", 1))!;
    expect(await s.revoke("ws-b", c.record.id)).toBe(false);
    expect(await s.revoke("ws-a", c.record.id)).toBe(true);
    expect(await s.resolve(c.key, 2)).toBeNull();
  });

  it("records when a key was last used", async () => {
    const s = new InMemoryKeyStore();
    const c = (await s.create("ws-a", "x", 1))!;
    await s.resolve(c.key, 500);
    expect((await s.list("ws-a"))[0].lastUsedAt).toBe(500);
  });
});

describe("POST /api/mcp", () => {
  it("refuses requests without a valid key, and answers notifications with 202", async () => {
    const keys = new InMemoryKeyStore();
    const c = (await keys.create("ws-a", "x", 1))!;
    vi.doMock("@/lib/mcp/keys", async (orig) => ({ ...(await orig<object>()), keyStore: () => keys }));
    vi.doMock("@/lib/seo/autopilot-store", async (orig) => ({ ...(await orig<object>()), autopilotStore: () => new InMemoryAutopilotStore() }));
    const { POST } = await import("@/app/api/mcp/route");
    const req = (auth: string | null, body: unknown) => new NextRequest("http://x/api/mcp", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) } });
    // Without a key, Populr can be described but not used.
    const listed = await POST(req(null, { jsonrpc: "2.0", id: 1, method: "tools/list" }));
    expect(listed.status).toBe(200);
    expect((await listed.json()).result.tools.length).toBe(TOOLS.length);
    // Connecting without credentials asks the client to sign in (Sign in with Populr).
    const init = await POST(req(null, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }));
    expect(init.status).toBe(401);
    // Outside production the issuer is the request's own origin (here http://x).
    expect(init.headers.get("www-authenticate")).toBe('Bearer realm="populr", resource_metadata="http://x/.well-known/oauth-protected-resource"');
    const call = await POST(req(null, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "seo_status", arguments: {} } }));
    expect(call.status).toBe(401);
    expect(call.headers.get("www-authenticate")).toContain("Bearer");
    // Anything else a directory asks gets a normal answer, not a 401 a gateway would turn
    // into a sign-in prompt.
    const resources = await POST(req(null, { jsonrpc: "2.0", id: 3, method: "resources/list" }));
    expect(resources.status).toBe(200);
    expect((await resources.json()).result).toEqual({ resources: [] });
    const prompts = await POST(req(null, { jsonrpc: "2.0", id: 4, method: "prompts/list" }));
    expect((await prompts.json()).result.prompts.map((p: { name: string }) => p.name)).toEqual(["turn_on", "set_up_seo", "apply_seo_fixes", "seo_audit"]);
    const unknown = await POST(req(null, { jsonrpc: "2.0", id: 5, method: "triggers/list" }));
    expect(unknown.status).toBe(200);
    expect((await unknown.json()).error.code).toBe(-32601);
    // A key that's presented must be valid, even just to list.
    expect((await POST(req("Bearer pop_wrong", { jsonrpc: "2.0", id: 1, method: "tools/list" }))).status).toBe(401);
    expect((await POST(req("Bearer pop_wrong", { jsonrpc: "2.0", id: 1, method: "ping" }))).status).toBe(401);
    expect((await POST(req(null, null))).status).toBe(400);
    expect((await POST(req(`Bearer ${c.key}`, { jsonrpc: "2.0", method: "notifications/initialized" }))).status).toBe(202);
    expect(await (await POST(req(`Bearer ${c.key}`, { jsonrpc: "2.0", id: 7, method: "ping" }))).json()).toEqual({ jsonrpc: "2.0", id: 7, result: {} });
    // X-Populr-Key, for gateways that pass a header through but can't add "Bearer ".
    const viaHeader = new NextRequest("http://x/api/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "seo_status", arguments: {} } }), headers: { "Content-Type": "application/json", "X-Populr-Key": c.key } });
    const r = await POST(viaHeader);
    expect(r.status).toBe(200);
    expect((await r.json()).result.content[0].text).toContain("isn't set up");
  });
});

describe("/api/mcp/keys and /api/seo/autopilot rate limits", () => {
  // The keys page re-reads both while it's open. When reads shared one budget with
  // create/revoke, an open page used up its own limit and the key list went blank.
  it("lets an open page keep reading, while creating keys stays strictly limited", async () => {
    const keys = new InMemoryKeyStore();
    vi.doMock("@/lib/auth", async (orig) => ({ ...(await orig<object>()), getSession: async () => null }));
    vi.doMock("@/lib/mcp/keys", async (orig) => ({ ...(await orig<object>()), keyStore: () => keys }));
    vi.doMock("@/lib/seo/autopilot-store", async (orig) => ({ ...(await orig<object>()), autopilotStore: () => new InMemoryAutopilotStore() }));
    const k = await import("@/app/api/mcp/keys/route");
    const a = await import("@/app/api/seo/autopilot/route");
    const ip = { "x-forwarded-for": "203.0.113.77" };
    const get = (path: string) => new NextRequest(`http://x${path}?wsid=ws-rl`, { headers: ip });

    for (let i = 0; i < 30; i++) {
      expect((await k.GET(get("/api/mcp/keys"))).status).toBe(200);
      expect((await a.GET(get("/api/seo/autopilot"))).status).toBe(200);
    }

    const post = () => new NextRequest("http://x/api/mcp/keys", { method: "POST", headers: { ...ip, "Content-Type": "application/json" }, body: JSON.stringify({ wsid: "ws-rl", name: "x" }) });
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await k.POST(post())).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    // Being limited on writes doesn't lock the page out of reading.
    expect((await k.GET(get("/api/mcp/keys"))).status).toBe(200);
  });
});

describe("MCP Registry listing (mcp/server.json)", () => {
  it("points at the live server, carries its version, and asks for the key as a secret bearer header", async () => {
    const { readFileSync } = await import("node:fs");
    const listing = JSON.parse(readFileSync("mcp/server.json", "utf8"));
    const { MCP_URL } = await import("@/lib/mcp/install");
    const { SERVER_INFO } = await import("@/lib/mcp/server");
    expect(listing.name).toBe("in.trypopulr/seo");
    expect(listing.version).toBe(SERVER_INFO.version);
    expect(listing.description.length).toBeLessThanOrEqual(100);
    const [remote] = listing.remotes;
    expect(remote).toMatchObject({ type: "streamable-http", url: MCP_URL });
    // Optional: editors that support MCP authorization sign in with OAuth instead.
    expect(remote.headers[0]).toMatchObject({ name: "Authorization", isSecret: true, isRequired: false, value: "Bearer {populr_key}" });
    expect(remote.headers[0].variables.populr_key.isSecret).toBe(true);
  });
});

describe("MCP prompts", () => {
  const deps = () => ({ autopilot: new InMemoryAutopilotStore() });

  it("declares prompts and builds apply_seo_fixes for one page or all", async () => {
    const init = await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, "ws", deps());
    expect((init as { result: { capabilities: Record<string, unknown> } }).result.capabilities).toHaveProperty("prompts");
    const one = await handle({ jsonrpc: "2.0", id: 2, method: "prompts/get", params: { name: "apply_seo_fixes", arguments: { path: "/pricing" } } }, "ws", deps());
    const text = (one as { result: { messages: { content: { text: string } }[] } }).result.messages[0].content.text;
    expect(text).toContain("only the page /pricing");
    expect(text).toContain('get_seo_fixes with path "/pricing"');
    expect(text).toContain("verify_page");
    const all = await handle({ jsonrpc: "2.0", id: 3, method: "prompts/get", params: { name: "apply_seo_fixes" } }, "ws", deps());
    expect((all as { result: { messages: { content: { text: string } }[] } }).result.messages[0].content.text).not.toContain("only the page");
  });

  it("requires seo_audit's url, and rejects unknown prompts", async () => {
    const missing = await handle({ jsonrpc: "2.0", id: 1, method: "prompts/get", params: { name: "seo_audit", arguments: {} } }, "ws", deps());
    expect((missing as { error: { code: number } }).error.code).toBe(-32602);
    const ok = await handle({ jsonrpc: "2.0", id: 2, method: "prompts/get", params: { name: "seo_audit", arguments: { url: "https://example.com/about" } } }, "ws", deps());
    expect((ok as { result: { messages: { content: { text: string } }[] } }).result.messages[0].content.text).toContain("https://example.com/about");
    const nope = await handle({ jsonrpc: "2.0", id: 3, method: "prompts/get", params: { name: "nope" } }, "ws", deps());
    expect((nope as { error: { code: number } }).error.code).toBe(-32602);
  });
});

describe("structured output", () => {
  // Clients (VS Code, Claude Code, the TypeScript SDK) reject a successful result whose
  // structuredContent doesn't match the tool's outputSchema — so check every path.
  const ajv = new Ajv({ strict: false, allErrors: true });
  const validators = new Map(TOOLS.map((t) => [t.name, ajv.compile(t.outputSchema)]));
  const PAGE = `<html><head><title>Shop A — groceries</title><meta name="description" content="Fresh groceries from Shop A in Pune, delivered to your door every day of the week."><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Store","name":"Shop A"},{"@type":"WebSite","name":"Shop A"}]}</script></head><body><h1>Shop A</h1></body></html>`;

  async function check(name: string, args: Record<string, unknown>, ws: string, deps: Parameters<typeof handle>[2]) {
    const r = (await handle(call(name, args), ws, deps)) as { result: { isError: boolean; structuredContent?: Record<string, unknown> } };
    if (r.result.isError) {
      expect(r.result.structuredContent, `${name} error result`).toBeUndefined();
      return null;
    }
    const v = validators.get(name)!;
    expect(r.result.structuredContent, `${name} has structured content`).toBeDefined();
    expect(v(r.result.structuredContent), `${name}: ${JSON.stringify(v.errors)}`).toBe(true);
    return r.result.structuredContent!;
  }

  it("declares an outputSchema for every tool, listed in tools/list", async () => {
    const { autopilot } = await setup();
    const list = (await handle({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "ws-a", { autopilot })) as { result: { tools: { name: string; outputSchema?: { type: string } }[] } };
    for (const t of list.result.tools) expect(t.outputSchema?.type, t.name).toBe("object");
  });

  it("matches the schema on every success path, for a set-up workspace", async () => {
    const { autopilot } = await setup();
    const deps = {
      autopilot,
      fetchPage: async () => PAGE,
      suggest: async () => ({ ok: true as const, fix: { title: "Shop A — fresh groceries in Pune", description: "Order fresh groceries from Shop A in Pune, delivered to your door every day.", status: "suggested" as const, before: { title: "Shop A — groceries", description: null }, at: 0 } }),
    };
    expect((await check("seo_status", {}, "ws-a", deps))?.status).toBe("ready");
    expect((await check("get_seo_fixes", {}, "ws-a", deps))?.status).toBe("ok");
    expect((await check("get_seo_fixes", { path: "/nope" }, "ws-a", deps))?.status).toBe("unknown_page");
    expect((await check("get_structured_data", { path: "/" }, "ws-a", deps))?.status).toBe("ok");
    expect((await check("audit_page", { url: "https://a.example/" }, "ws-a", deps))?.status).toBe("ok");
    expect((await check("draft_page_fix", { path: "/" }, "ws-a", deps))?.status).toBe("not_saved_already_approved");
    expect((await check("draft_page_fix", { path: "/pricing" }, "ws-a", deps))?.status).toBe("saved");
    expect((await check("generate_llms_txt", {}, "ws-a", deps))?.status).toBe("ok");
    expect((await check("verify_page", { url: "https://a.example/" }, "ws-a", deps))?.status).toBe("live");
    // A page with no fix of its own is still checked for the site-wide structured data.
    expect((await check("verify_page", { url: "https://a.example/pricing" }, "ws-a", deps))?.status).toBe("live");
    // Error paths: text only.
    expect(await check("verify_page", { url: "https://elsewhere.example/" }, "ws-a", deps)).toBeNull();
    expect(await check("audit_page", { url: "not a url" }, "ws-a", deps)).toBeNull();
  });

  it("matches the schema when nothing is set up, or the business details are missing", async () => {
    const autopilot = new InMemoryAutopilotStore();
    await autopilot.save({ workspace: "ws-c", site: "https://c.example", enabled: false, business: null, faq: [], pages: {} });
    // audit_page needs no setup; setup_site is what does the setting up.
    const args: Record<string, Record<string, unknown>> = { verify_page: { url: "https://x.example/" }, draft_page_fix: { path: "/" }, approve_page_fix: { path: "/" }, set_business_details: { name: "X" } };
    for (const t of TOOLS.filter((t) => t.name !== "audit_page" && t.name !== "setup_site")) {
      expect((await check(t.name, args[t.name] ?? {}, "ws-none", { autopilot }))?.status, t.name).toBe("not_set_up");
    }
    expect((await check("get_structured_data", {}, "ws-c", { autopilot }))?.status).toBe("needs_business_details");
    expect((await check("generate_llms_txt", {}, "ws-c", { autopilot }))?.status).toBe("needs_business_details");
    expect((await check("verify_page", { url: "https://c.example/" }, "ws-c", { autopilot, fetchPage: async () => "<html></html>" }))?.status).toBe("no_approved_fixes");
  });
});

describe("/api/mcp/keys needs an account", () => {
  it("refuses to list, make or revoke keys when signed out, once accounts are on", async () => {
    vi.doMock("@/lib/auth", async (orig) => ({ ...(await orig<object>()), getSession: async () => null }));
    vi.doMock("@/lib/db", async (orig) => ({ ...(await orig<object>()), db: () => (() => []) as unknown }));
    const k = await import("@/app/api/mcp/keys/route");
    const ip = { "x-forwarded-for": "203.0.113.90" };
    const get = await k.GET(new NextRequest("http://x/api/mcp/keys?wsid=ws-x", { headers: ip }));
    expect(get.status).toBe(401);
    expect(await get.json()).toEqual({ error: "sign_in_required" });
    expect((await k.POST(new NextRequest("http://x/api/mcp/keys", { method: "POST", headers: { ...ip, "Content-Type": "application/json" }, body: JSON.stringify({ wsid: "ws-x", name: "x" }) }))).status).toBe(401);
    expect((await k.DELETE(new NextRequest("http://x/api/mcp/keys?wsid=ws-x&id=k1", { method: "DELETE", headers: ip }))).status).toBe(401);
  });

  it("works for a signed-in account, under that account's workspace", async () => {
    const keys = new InMemoryKeyStore();
    vi.doMock("@/lib/auth", async (orig) => ({ ...(await orig<object>()), getSession: async () => ({ userId: "u1", email: "a@b.c" }) }));
    vi.doMock("@/lib/db", async (orig) => ({ ...(await orig<object>()), db: () => (() => []) as unknown }));
    vi.doMock("@/lib/mcp/keys", async (orig) => ({ ...(await orig<object>()), keyStore: () => keys }));
    const k = await import("@/app/api/mcp/keys/route");
    const made = await k.POST(new NextRequest("http://x/api/mcp/keys", { method: "POST", headers: { "x-forwarded-for": "203.0.113.91", "Content-Type": "application/json" }, body: JSON.stringify({ wsid: "anything", name: "Laptop" }) }));
    expect(made.status).toBe(200);
    expect(await keys.resolve((await made.json()).key, 1)).toBe("user:u1");
  });
});

describe("server identity", () => {
  it("announces Populr's logo and website when a client connects", async () => {
    const r = (await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } }, "", { autopilot: new InMemoryAutopilotStore() })) as { result: { serverInfo: { icons: { src: string; mimeType: string }[]; websiteUrl: string } } };
    const { icons, websiteUrl } = r.result.serverInfo;
    expect(websiteUrl).toBe("https://www.trypopulr.in/developers");
    expect(icons.map((i) => i.mimeType)).toEqual(["image/svg+xml", "image/png"]);
    for (const i of icons) expect(i.src.startsWith("https://www.trypopulr.in/")).toBe(true);
  });
});

describe("keys made signed out", () => {
  const call = (key: string) => new NextRequest("http://x/api/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "seo_status", arguments: {} } }), headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "x-forwarded-for": "203.0.113.120" } });

  it("stop working once accounts are on; account keys keep working", async () => {
    const keys = new InMemoryKeyStore();
    const anon = (await keys.create("anon:browser-ws", "old", 1))!;
    const owned = (await keys.create("user:u1", "laptop", 1))!;
    vi.doMock("@/lib/db", async (orig) => ({ ...(await orig<object>()), db: () => (() => []) as unknown }));
    vi.doMock("@/lib/mcp/keys", async (orig) => ({ ...(await orig<object>()), keyStore: () => keys }));
    vi.doMock("@/lib/seo/autopilot-store", async (orig) => ({ ...(await orig<object>()), autopilotStore: () => new InMemoryAutopilotStore() }));
    const { POST } = await import("@/app/api/mcp/route");
    const refused = await POST(call(anon.key));
    expect(refused.status).toBe(401);
    expect((await refused.json()).error.message).toContain("create a new one");
    expect((await POST(call(owned.key))).status).toBe(200);
  });

  it("still work without a database (local development has no accounts)", async () => {
    const keys = new InMemoryKeyStore();
    const anon = (await keys.create("anon:browser-ws", "dev", 1))!;
    vi.doMock("@/lib/db", async (orig) => ({ ...(await orig<object>()), db: () => null }));
    vi.doMock("@/lib/mcp/keys", async (orig) => ({ ...(await orig<object>()), keyStore: () => keys }));
    vi.doMock("@/lib/seo/autopilot-store", async (orig) => ({ ...(await orig<object>()), autopilotStore: () => new InMemoryAutopilotStore() }));
    const { POST } = await import("@/app/api/mcp/route");
    expect((await POST(call(anon.key))).status).toBe(200);
  });
});

describe("setting up from the editor", () => {
  // The whole setup, through the tools alone: nothing in Populr's web app is needed.
  const ajv = new Ajv({ strict: false });
  const schema = new Map(TOOLS.map((t) => [t.name, ajv.compile(t.outputSchema)]));
  async function run(name: string, args: Record<string, unknown>, deps: Parameters<typeof handle>[2]) {
    const r = (await handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, "ws-new", deps)) as { result: { isError: boolean; structuredContent?: Record<string, unknown>; content: { text: string }[] } };
    if (!r.result.isError) expect(schema.get(name)!(r.result.structuredContent), `${name} output schema`).toBe(true);
    return r.result;
  }

  it("goes from nothing to an approved fix, without the web app", async () => {
    const autopilot = new InMemoryAutopilotStore();
    const deps = {
      autopilot,
      suggest: async () => ({ ok: true as const, fix: { title: "Rao's Bakery — fresh bread in Jayanagar", description: "Sourdough, cakes and pav baked every morning in Jayanagar, Bengaluru. Order ahead or drop in.", status: "suggested" as const, before: { title: "Home", description: null }, at: 0 } }),
    };
    expect((await run("seo_status", {}, deps)).structuredContent?.status).toBe("not_set_up");
    expect((await run("seo_status", {}, deps)).content[0].text).toContain("setup_site");

    expect((await run("setup_site", { site: "raosbakery.in/menu" }, deps)).structuredContent).toEqual({ status: "created", site: "https://raosbakery.in" });
    expect((await run("setup_site", { site: "https://raosbakery.in" }, deps)).structuredContent?.status).toBe("already_set_up");
    const other = await run("setup_site", { site: "https://elsewhere.example" }, deps);
    expect(other.structuredContent?.status).toBe("different_site_set_up");
    expect((await autopilot.get("ws-new"))!.site).toBe("https://raosbakery.in");

    expect((await run("set_business_details", { name: "Rao's Bakery", type: "Store", description: "Fresh bread in Jayanagar.", address: { locality: "Bengaluru", country: "IN" } }, deps)).structuredContent).toEqual({ status: "saved", name: "Rao's Bakery", type: "Store" });
    expect((await run("get_structured_data", {}, deps)).structuredContent?.status).toBe("ok");

    expect((await run("approve_page_fix", { path: "/" }, deps)).structuredContent?.status).toBe("nothing_to_approve");
    expect((await run("draft_page_fix", { path: "/" }, deps)).structuredContent?.status).toBe("saved");
    const approved = await run("approve_page_fix", { path: "/", description: "Sourdough, celebration cakes and pav baked every morning in Jayanagar, Bengaluru. Order ahead or drop in." }, deps);
    expect(approved.structuredContent).toMatchObject({ status: "approved", path: "/", title: "Rao's Bakery — fresh bread in Jayanagar" });

    const fixes = await run("get_seo_fixes", {}, deps);
    expect(fixes.structuredContent?.pages).toEqual([expect.objectContaining({ path: "/", title: "Rao's Bakery — fresh bread in Jayanagar", description: expect.stringContaining("celebration cakes") })]);
  });

  it("refuses an address that isn't a public website, and business details without a name", async () => {
    const autopilot = new InMemoryAutopilotStore();
    // Local addresses are allowed in development on purpose (working on Populr locally);
    // production refuses them.
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect((await run("setup_site", { site: "http://localhost:3000" }, { autopilot })).isError).toBe(true);
      expect((await run("setup_site", { site: "http://10.0.0.5" }, { autopilot })).isError).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
    await run("setup_site", { site: "https://raosbakery.in" }, { autopilot });
    const noName = await handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "set_business_details", arguments: { type: "Store" } } }, "ws-new", { autopilot });
    expect((noName as { error: { code: number } }).error.code).toBe(-32602);
  });

  it("marks the tools that change settings as needing the user's say-so", () => {
    const writes = TOOLS.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name).sort();
    expect(writes).toEqual(["approve_page_fix", "draft_page_fix", "set_business_details", "setup_site", "turn_on"]);
    for (const n of ["approve_page_fix", "set_business_details", "turn_on"]) expect(TOOLS.find((t) => t.name === n)!.annotations.destructiveHint).toBe(true);
  });

  it("offers a prompt that walks an agent through the whole setup", async () => {
    const r = (await handle({ jsonrpc: "2.0", id: 1, method: "prompts/get", params: { name: "set_up_seo" } }, "", { autopilot: new InMemoryAutopilotStore() })) as { result: { messages: { content: { text: string } }[] } };
    const text = r.result.messages[0].content.text;
    for (const tool of ["seo_status", "setup_site", "set_business_details", "draft_page_fix", "approve_page_fix", "get_seo_fixes", "generate_llms_txt", "verify_page"]) expect(text).toContain(tool);
  });
});
