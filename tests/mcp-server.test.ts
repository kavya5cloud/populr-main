import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hashKey, InMemoryKeyStore, looksLikeKey } from "@/lib/mcp/keys";
import { handle, SUPPORTED_VERSIONS } from "@/lib/mcp/server";
import { InMemoryAutopilotStore } from "@/lib/seo/autopilot-store";

// Populr's MCP server. Verified with the official MCP Inspector before these were written:
// it initialised, listed seven tools and called seo_status, get_seo_fixes and verify_page
// against a real public site. These pin the protocol, the key handling, and the tenant line.

afterEach(() => { vi.resetModules(); vi.doUnmock("@/lib/mcp/keys"); vi.doUnmock("@/lib/seo/autopilot-store"); });

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

  it("lists tools with schemas, and marks the one that writes", async () => {
    const { autopilot } = await setup();
    const r = await handle({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "ws-a", { autopilot }) as { result: { tools: { name: string; inputSchema: object; annotations: { readOnlyHint: boolean } }[] } };
    const names = r.result.tools.map((t) => t.name);
    expect(names).toEqual(["seo_status", "get_seo_fixes", "get_structured_data", "audit_page", "draft_page_fix", "generate_llms_txt", "verify_page"]);
    expect(r.result.tools.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name)).toEqual(["draft_page_fix"]);
  });

  it("rejects unknown methods, unknown tools and missing arguments as protocol errors", async () => {
    const { autopilot } = await setup();
    expect(await handle({ jsonrpc: "2.0", id: 1, method: "resources/list" }, "ws-a", { autopilot })).toMatchObject({ error: { code: -32601 } });
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
    expect((await POST(req(null, { jsonrpc: "2.0", id: 1, method: "ping" }))).status).toBe(401);
    expect((await POST(req("Bearer pop_wrong", { jsonrpc: "2.0", id: 1, method: "ping" }))).status).toBe(401);
    expect((await POST(req(`Bearer ${c.key}`, { jsonrpc: "2.0", method: "notifications/initialized" }))).status).toBe(202);
    expect(await (await POST(req(`Bearer ${c.key}`, { jsonrpc: "2.0", id: 7, method: "ping" }))).json()).toEqual({ jsonrpc: "2.0", id: 7, result: {} });
  });
});
