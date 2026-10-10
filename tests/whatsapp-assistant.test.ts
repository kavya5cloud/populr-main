import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { parseInbound, sendText, verifySignature, MAX_TEXT } from "@/lib/whatsapp/cloud";
import { handleInbound, type AssistantDeps, type PendingPost } from "@/lib/whatsapp/assistant";
import { InMemoryWhatsAppStore, maskNumber } from "@/lib/whatsapp/links";

// The WhatsApp assistant. The properties that matter, in order: a delivery that Meta did not
// sign is refused; a number can only ever act on the workspace it is linked to; and the
// commands do exactly what they say, against the list as it stands now.

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

const SECRET = "app-secret";
const sign = (body: string) => "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
const msg = (from: string, text: string, id = `m${Math.random()}`) => ({ id, from, text, at: 0 });

function deps(over: Partial<AssistantDeps> = {}, queue: Record<string, PendingPost[]> = {}) {
  const store = new InMemoryWhatsAppStore();
  const approved: string[] = [], skipped: string[] = [];
  const d: AssistantDeps = {
    store, now: () => 1_000_000,
    approvals: {
      pending: async (ws) => (queue[ws] ?? []).filter((p) => !approved.includes(p.id) && !skipped.includes(p.id)),
      approve: async (_ws, ids) => { approved.push(...ids); return ids.length; },
      skip: async (_ws, ids) => { skipped.push(...ids); return ids.length; },
    },
    research: async () => null,
    timezone: async () => "Asia/Kolkata",
    appUrl: "https://www.trypopulr.in/app",
    ...over,
  };
  return { d, store, approved, skipped };
}

const post = (id: string, platform = "linkedin"): PendingPost => ({ id, platform, at: Date.parse("2026-10-13T03:30:00Z"), label: `Post ${id}` });

describe("proving a delivery came from Meta", () => {
  it("accepts Meta's signature and nothing else", () => {
    const body = '{"entry":[]}';
    expect(verifySignature(body, sign(body), SECRET)).toBe(true);
    expect(verifySignature(body, sign(body + " "), SECRET), "a signature over different bytes").toBe(false);
    expect(verifySignature(body, null, SECRET)).toBe(false);
    expect(verifySignature(body, "sha256=00", SECRET), "a short signature").toBe(false);
    expect(verifySignature(body, sign(body), "other-secret")).toBe(false);
  });

  it("the webhook refuses an unsigned post and an unconfigured server", async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", "");
    let { POST } = await import("@/app/api/whatsapp/webhook/route");
    expect((await POST(new NextRequest("http://x/api/whatsapp/webhook", { method: "POST", body: "{}" }))).status).toBe(503);

    vi.resetModules();
    vi.stubEnv("WHATSAPP_APP_SECRET", SECRET);
    ({ POST } = await import("@/app/api/whatsapp/webhook/route"));
    const forged = new NextRequest("http://x/api/whatsapp/webhook", { method: "POST", body: '{"entry":[]}', headers: { "x-hub-signature-256": "sha256=deadbeef" } });
    expect((await POST(forged)).status).toBe(401);
  });

  it("completes Meta's handshake only with the right verify token", async () => {
    vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "tok");
    const { GET } = await import("@/app/api/whatsapp/webhook/route");
    const ok = await GET(new NextRequest("http://x/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=tok&hub.challenge=42"));
    expect(await ok.text()).toBe("42");
    expect((await GET(new NextRequest("http://x/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42"))).status).toBe(403);
  });
});

describe("reading what arrived", () => {
  it("takes text and button replies, ignores everything else", () => {
    const payload = { entry: [{ changes: [{ value: { messages: [
      { id: "a", from: "91 98765 43210", timestamp: "1700000000", type: "text", text: { body: " today " } },
      { id: "b", from: "919876543210", type: "button", button: { text: "Approve all" } },
      { id: "c", from: "919876543210", type: "image", image: {} },
    ] } }] }] };
    expect(parseInbound(payload).map((m) => [m.id, m.from, m.text])).toEqual([["a", "919876543210", "today"], ["b", "919876543210", "Approve all"]]);
  });
});

describe("linking a number", () => {
  it("links with a valid code, once", async () => {
    const { d, store } = deps();
    const code = await store.createCode("ws1", 1_000_000);
    expect(await handleInbound(msg("911", `link ${code}`), d)).toMatch(/You're connected/);
    expect((await store.byNumber("911"))?.workspace).toBe("ws1");
    // The same code a second time — say, from someone who saw the screen — does nothing.
    expect(await handleInbound(msg("922", `link ${code}`), d)).toMatch(/didn't work/);
    expect(await store.byNumber("922")).toBeNull();
  });

  it("refuses an expired code", async () => {
    const { d, store } = deps({ now: () => 1_000_000 + 16 * 60_000 });
    const code = await store.createCode("ws1", 1_000_000);
    expect(await handleInbound(msg("911", `link ${code}`), d)).toMatch(/didn't work/);
  });

  it("an unlinked number can do nothing but link", async () => {
    const { d, approved } = deps({}, { ws1: [post("p1")] });
    for (const t of ["today", "approve all", "approve 1", "what's trending in tea?"]) {
      expect(await handleInbound(msg("999", t), d), t).toMatch(/To connect this number/);
    }
    expect(approved).toEqual([]);
  });

  it("a number acts only on its own workspace", async () => {
    const { d, store, approved } = deps({}, { ws1: [post("mine")], ws2: [post("theirs")] });
    await store.link("911", "ws1", 0);
    await handleInbound(msg("911", "approve all"), d);
    expect(approved).toEqual(["mine"]);
  });

  it("stop disconnects", async () => {
    const { d, store } = deps();
    await store.link("911", "ws1", 0);
    expect(await handleInbound(msg("911", "STOP"), d)).toMatch(/Disconnected/);
    expect(await store.byNumber("911")).toBeNull();
  });
});

describe("approving from a phone", () => {
  async function linked(queue: PendingPost[]) {
    const x = deps({}, { ws1: queue });
    await x.store.link("911", "ws1", 0);
    return x;
  }

  it("lists what is waiting, in the workspace's own time", async () => {
    const { d } = await linked([post("p1"), post("p2", "x")]);
    const r = await handleInbound(msg("911", "today"), d);
    expect(r).toMatch(/2 posts are waiting/);
    expect(r).toMatch(/\*1\.\* LinkedIn · Tue/);
    expect(r).toMatch(/9:00 am/i);   // 03:30 UTC is 09:00 in Asia/Kolkata
  });

  it("approves by number, and skips by number", async () => {
    const { d, approved, skipped } = await linked([post("p1"), post("p2"), post("p3")]);
    expect(await handleInbound(msg("911", "approve 1 and 3"), d)).toMatch(/Approved 2/);
    expect(approved).toEqual(["p1", "p3"]);
    // The list is re-read, so "1" now means p2 — the only one left.
    await handleInbound(msg("911", "skip 1"), d);
    expect(skipped).toEqual(["p2"]);
  });

  it("does not act on a number that isn't on the list", async () => {
    const { d, approved } = await linked([post("p1")]);
    expect(await handleInbound(msg("911", "approve 7"), d)).toMatch(/couldn't match/);
    expect(approved).toEqual([]);
  });

  it("says plainly when nothing is waiting", async () => {
    const { d } = await linked([]);
    expect(await handleInbound(msg("911", "today"), d)).toMatch(/Nothing is waiting/);
  });
});

describe("questions", () => {
  it("sends market questions to research, with its sources", async () => {
    const research = vi.fn(async () => ({ answer: "Dark stores are expanding [1].", sources: [{ title: "Dark stores expand", url: "https://n/1" }] }));
    const { d, store } = deps({ research });
    await store.link("911", "ws1", 0);
    const r = await handleInbound(msg("911", "what's trending in quick commerce?"), d);
    expect(research).toHaveBeenCalledWith("ws1", "what's trending in quick commerce?");
    expect(r).toContain("Dark stores are expanding [1].");
    expect(r).toContain("[1] Dark stores expand\nhttps://n/1");
  });

  it("says when research found nothing, rather than inventing an answer", async () => {
    const { d, store } = deps({ research: async () => null });
    await store.link("911", "ws1", 0);
    expect(await handleInbound(msg("911", "any news on kirana delivery?"), d)).toMatch(/couldn't find anything/);
  });
});

describe("sending", () => {
  it("trims to WhatsApp's limit instead of being rejected", async () => {
    let sent = "";
    const f = vi.fn(async (_u: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body)).text.body;
      return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }));
    });
    await sendText({ token: "t", phoneNumberId: "123" }, "911", "x".repeat(MAX_TEXT + 500), f as unknown as typeof fetch);
    expect(sent.length).toBe(MAX_TEXT);
  });

  it("masks a number to its country code and last four", () => {
    expect(maskNumber("919876543210")).toBe("+91 ••••• 3210");
  });
});

describe("redeliveries", () => {
  it("handles a message id once", async () => {
    const store = new InMemoryWhatsAppStore();
    expect(await store.firstSeen("wamid.A", 0)).toBe(true);
    expect(await store.firstSeen("wamid.A", 1_000)).toBe(false);
  });
});
