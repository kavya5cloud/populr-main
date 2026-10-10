import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { url } from "@/lib/seo";
import { maskNumber } from "@/lib/whatsapp/links";
import { answerCustomer } from "@/lib/whatsapp/business/flow";
import { businessConfig, businessStore, verifyBusinessNumber } from "@/lib/whatsapp/business/shared";

export const runtime = "nodejs";

// The business's own WhatsApp, from Settings.
//
//   GET     connection status, the webhook URL and verify token to paste into Meta, the
//           knowledge the agent answers from, and customers waiting on the founder
//   POST    connect: credentials are checked against Meta before anything is stored
//   PATCH   switch the agent on/off, edit its knowledge, or answer a waiting customer
//   DELETE  disconnect
//
// The access token and app secret go in once and never come back out.

const MAX_KNOWLEDGE = 8_000;

async function ws(req: NextRequest, wsid: string | null): Promise<{ error: NextResponse } | { w: string }> {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 40 : 12, 60_000);
  if (!limit.allowed) return { error: NextResponse.json({ error: "rate_limited" }, { status: 429 }) };
  const w = await workspaceKey(wsid);
  return w ? { w } : { error: NextResponse.json({ error: "no_key" }, { status: 400 }) };
}

export async function GET(req: NextRequest) {
  const r = await ws(req, req.nextUrl.searchParams.get("wsid"));
  if ("error" in r) return r.error;
  const store = businessStore();
  const conn = await store.byWorkspace(r.w);
  if (!conn) return NextResponse.json({ ok: true, connected: false });
  const open = await store.openEscalations(r.w);
  return NextResponse.json({
    ok: true, connected: true,
    number: maskNumber(conn.displayNumber),
    enabled: conn.enabled,
    knowledge: conn.knowledge,
    webhookUrl: url(`/api/whatsapp/business/${conn.id}/webhook`),
    verifyToken: conn.verifyToken,
    waiting: open.map((e) => ({ ref: e.ref, question: e.question, from: maskNumber(e.customer), askedAt: e.askedAt })),
  });
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({})) as { wsid?: string; phoneNumberId?: string; token?: string; appSecret?: string };
  const r = await ws(req, b.wsid ?? null);
  if ("error" in r) return r.error;
  const phoneNumberId = String(b.phoneNumberId ?? "").trim(), token = String(b.token ?? "").trim(), appSecret = String(b.appSecret ?? "").trim();
  if (!/^\d{6,20}$/.test(phoneNumberId) || token.length < 20 || appSecret.length < 16) {
    return NextResponse.json({ error: "invalid", detail: "Check the Phone number ID, access token and app secret." }, { status: 400 });
  }
  const check = await verifyBusinessNumber(phoneNumberId, token);
  if (!check.ok) return NextResponse.json({ error: "rejected_by_meta", detail: check.error }, { status: 400 });
  const conn = await businessStore().connect({ workspace: r.w, phoneNumberId, displayNumber: check.displayNumber, secrets: { token, appSecret }, now: Date.now() });
  return NextResponse.json({ ok: true, number: maskNumber(conn.displayNumber), name: check.name });
}

export async function PATCH(req: NextRequest) {
  const b = await req.json().catch(() => ({})) as { wsid?: string; enabled?: boolean; knowledge?: string; answer?: { ref?: number; text?: string } };
  const r = await ws(req, b.wsid ?? null);
  if ("error" in r) return r.error;
  const store = businessStore();
  const conn = await store.byWorkspace(r.w);
  if (!conn) return NextResponse.json({ error: "not_connected" }, { status: 404 });

  if (b.answer) {
    const message = await answerCustomer(r.w, Number(b.answer.ref), String(b.answer.text ?? ""), { business: store, businessConfig, now: Date.now });
    return NextResponse.json({ ok: true, message });
  }
  await store.update(conn.id, {
    ...(typeof b.enabled === "boolean" ? { enabled: b.enabled } : {}),
    ...(typeof b.knowledge === "string" ? { knowledge: b.knowledge.slice(0, MAX_KNOWLEDGE) } : {}),
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const r = await ws(req, req.nextUrl.searchParams.get("wsid"));
  if ("error" in r) return r.error;
  const store = businessStore();
  const conn = await store.byWorkspace(r.w);
  if (conn) await store.disconnect(conn.id);
  return NextResponse.json({ ok: true });
}
