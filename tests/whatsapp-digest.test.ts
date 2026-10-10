import { describe, expect, it } from "vitest";
import { digestDue, localParts, sendDigests } from "@/lib/whatsapp/digest";
import { InMemoryWhatsAppStore } from "@/lib/whatsapp/links";

// The morning message is the one time Populr starts a WhatsApp conversation, so it has to be
// right on three counts: the founder's morning, not the server's; once a day; and only when
// there is something waiting. A daily "nothing today" is how a channel gets muted.

const IST = "Asia/Kolkata";
const at = (iso: string) => Date.parse(iso);

describe("when it is due", () => {
  it("uses the workspace's clock, not UTC", () => {
    // 03:00 UTC is 08:30 in India — not yet. 03:30 UTC is 09:00 — due.
    expect(digestDue(at("2026-10-12T03:00:00Z"), IST, null)).toBe(false);
    expect(digestDue(at("2026-10-12T03:30:00Z"), IST, null)).toBe(true);
    expect(localParts(at("2026-10-12T03:30:00Z"), IST)).toEqual({ date: "2026-10-12", hour: 9 });
  });

  it("is once per local day", () => {
    const sent = at("2026-10-12T03:35:00Z");
    expect(digestDue(at("2026-10-12T10:00:00Z"), IST, sent), "same day, later").toBe(false);
    expect(digestDue(at("2026-10-13T03:31:00Z"), IST, sent), "next morning").toBe(true);
  });

  it("treats the local date as the day, across the UTC midnight", () => {
    // 19:00 UTC on the 12th is 00:30 on the 13th in India — a new day there, but before 9.
    expect(digestDue(at("2026-10-12T19:00:00Z"), IST, at("2026-10-12T04:00:00Z"))).toBe(false);
  });
});

describe("who gets one", () => {
  async function run(pending: Record<string, number>, last: Record<string, number> = {}) {
    const store = new InMemoryWhatsAppStore();
    for (const ws of Object.keys(pending)) await store.link(`91${ws}`, ws, 0);
    for (const [ws, t] of Object.entries(last)) await store.markDigest(ws, t);
    const sent: [string, number][] = [];
    const now = at("2026-10-12T04:00:00Z");
    const r = await sendDigests({
      store, now: () => now, timezone: async () => IST,
      approvals: { pending: async (ws) => Array.from({ length: pending[ws] ?? 0 }, (_, i) => ({ id: `${ws}${i}`, platform: "x", at: 0, label: "" })), approve: async () => 0, skip: async () => 0 },
    }, async (to, n) => { sent.push([to, n]); }, Date.now() + 10_000);
    return { r, sent, store };
  }

  it("messages only workspaces with something waiting", async () => {
    const { r, sent } = await run({ a: 3, b: 0 });
    expect(sent).toEqual([["91a", 3]]);
    expect(r).toMatchObject({ sent: 1, skippedNothingWaiting: 1 });
  });

  it("does not send twice in a day", async () => {
    const { sent } = await run({ a: 2 }, { a: at("2026-10-12T03:40:00Z") });
    expect(sent).toEqual([]);
  });

  it("records the send, so the next pass this morning skips it", async () => {
    const { store } = await run({ a: 1 });
    expect(await store.lastDigest("a")).toBe(at("2026-10-12T04:00:00Z"));
  });
});
