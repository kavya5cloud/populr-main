import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryUsageStore, KEYLESS, clientName, summarize, usageEvent, workspaceHash } from "@/lib/mcp/usage";
import { InMemoryKeyStore } from "@/lib/mcp/keys";
import { InMemoryAutopilotStore } from "@/lib/seo/autopilot-store";

// MCP usage is counted, not logged: method, tool, a closed-set outcome and the client's
// name — never keys, arguments, URLs or results — with workspaces one-way hashed.

afterEach(() => { vi.resetModules(); vi.doUnmock("@/lib/mcp/keys"); vi.doUnmock("@/lib/mcp/usage"); vi.doUnmock("@/lib/seo/autopilot-store"); vi.doUnmock("@/lib/admin"); });

const T = Date.UTC(2026, 9, 17, 12);

describe("what a call becomes", () => {
  it("uses the tool's structured status as the outcome, and nothing from the arguments", () => {
    const msg = { jsonrpc: "2.0" as const, id: 1, method: "tools/call", params: { name: "verify_page", arguments: { url: "https://secret.example/private" } } };
    const e = usageEvent(msg, { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "…" }], structuredContent: { status: "live", url: "https://secret.example/private" }, isError: false } }, "user:u1");
    expect(e).toEqual({ workspace: "user:u1", method: "tools/call", tool: "verify_page", outcome: "live", client: undefined });
    expect(JSON.stringify(e)).not.toContain("secret.example");
  });

  it("marks tool errors and protocol errors apart, and takes the client from initialize", () => {
    expect(usageEvent({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "audit_page" } }, { jsonrpc: "2.0", id: 1, result: { content: [], isError: true } }, "w").outcome).toBe("tool_error");
    expect(usageEvent({ jsonrpc: "2.0", id: 1, method: "nope" }, { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "x" } }, "w").outcome).toBe("rpc_error");
    expect(usageEvent({ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "Visual Studio Code" } } }, { jsonrpc: "2.0", id: 1, result: {} }, "w").client).toBe("Visual Studio Code");
  });

  it("hashes workspaces one way and keeps client names short and plain", () => {
    expect(workspaceHash("user:u1")).toMatch(/^[0-9a-f]{16}$/);
    expect(workspaceHash("user:u1")).not.toContain("u1");
    expect(workspaceHash(null)).toBe(KEYLESS);
    expect(clientName("<script>alert(1)</script>Cursor".repeat(3)).length).toBeLessThanOrEqual(40);
    expect(clientName("<b>Cursor</b>")).toBe("bCursor/b");
  });
});

describe("the funnel", () => {
  it("counts workspaces at each step, from the day's counts", async () => {
    const s = new InMemoryUsageStore();
    const ev = (ws: string | null, method: string, tool?: string, outcome = "ok", client?: string) => s.record({ workspace: ws, method, tool, outcome, client }, T);
    await ev("a", "initialize", undefined, "ok", "Cursor");
    await ev("a", "tools/call", "seo_status", "ready");
    await ev("a", "tools/call", "get_seo_fixes", "ok");
    await ev("a", "tools/call", "verify_page", "live");
    await ev("a", "tools/call", "verify_page", "live");
    await ev("b", "initialize", undefined, "ok", "Visual Studio Code");
    await ev("b", "tools/call", "get_seo_fixes", "not_set_up");
    await ev(null, "tools/list");
    const sum = summarize(await s.rows("2026-10-01"), "2026-10-01");
    expect(sum.funnel).toEqual({ workspacesConnected: 2, workspacesCalledATool: 2, workspacesFetchedFixes: 1, workspacesVerifiedLive: 1 });
    expect(sum.daily).toEqual([{ day: "2026-10-17", workspaces: 2, toolCalls: 5, toolErrors: 0, keylessCalls: 1 }]);
    expect(sum.tools.find((t) => t.tool === "verify_page")).toEqual({ tool: "verify_page", calls: 2, workspaces: 1, outcomes: { live: 2 } });
    expect(sum.clients.map((c) => c.client).sort()).toEqual(["Cursor", "Visual Studio Code"]);
  });
});

describe("/api/mcp counts its calls", () => {
  it("records a tool call against the key's workspace, after answering", async () => {
    const usage = new InMemoryUsageStore();
    const keys = new InMemoryKeyStore();
    const k = (await keys.create("user:u9", "x", 1))!;
    vi.doMock("@/lib/mcp/keys", async (orig) => ({ ...(await orig<object>()), keyStore: () => keys }));
    vi.doMock("@/lib/mcp/usage", async (orig) => ({ ...(await orig<object>()), usageStore: () => usage }));
    vi.doMock("@/lib/seo/autopilot-store", async (orig) => ({ ...(await orig<object>()), autopilotStore: () => new InMemoryAutopilotStore() }));
    const { POST } = await import("@/app/api/mcp/route");
    const res = await POST(new NextRequest("http://x/api/mcp", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${k.key}`, "x-forwarded-for": "203.0.113.150" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "seo_status", arguments: {} } }) }));
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
    const rows = await usage.rows("2000-01-01");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ws: workspaceHash("user:u9"), method: "tools/call", tool: "seo_status", outcome: "not_set_up", calls: 1 });
    expect(JSON.stringify(rows)).not.toContain(k.key);
  });

  it("the admin view is admins only", async () => {
    vi.doMock("@/lib/admin", () => ({ isAdmin: async () => false }));
    const { GET } = await import("@/app/api/admin/mcp-usage/route");
    expect((await GET(new NextRequest("http://x/api/admin/mcp-usage"))).status).toBe(403);
  });
});
