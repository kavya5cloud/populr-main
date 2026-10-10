import { NextRequest, NextResponse, after } from "next/server";
import { parseInbound, verifySignature } from "@/lib/whatsapp/cloud";
import { maskNumber } from "@/lib/whatsapp/links";
import { handleCustomerMessage } from "@/lib/whatsapp/business/flow";
import { businessConfig, businessStore, flowDeps } from "@/lib/whatsapp/business/shared";

export const runtime = "nodejs";
export const maxDuration = 60;

// One business's WhatsApp webhook: /api/whatsapp/business/<connection id>/webhook.
//
// Each connected business points its own Meta app here. The connection is identified by the
// path and verified with THAT connection's app secret, so a delivery signed for one business
// can never be accepted as another's.
//
// Customer messages are never logged — only that one arrived, the masked number, and what
// the agent did with it.

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const conn = await businessStore().get(id).catch(() => null);
  const p = req.nextUrl.searchParams;
  if (conn && p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === conn.verifyToken) {
    return new Response(p.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const store = businessStore();
  const conn = await store.get(id).catch(() => null);
  if (!conn) return NextResponse.json({ error: "unknown" }, { status: 404 });
  const secrets = await store.secrets(id).catch(() => null);
  if (!secrets) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), secrets.appSecret)) {
    return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  }

  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ ok: true }); }
  const messages = parseInbound(payload);

  if (messages.length) {
    after(async () => {
      const deps = await flowDeps();
      const cfg = await businessConfig(conn);
      if (!cfg) return;
      for (const m of messages) {
        try {
          const outcome = await handleCustomerMessage(conn, cfg, m, deps);
          console.info(JSON.stringify({ event: "whatsapp_customer", connection: conn.id, from: maskNumber(m.from), outcome }));
        } catch (e) {
          console.warn(JSON.stringify({ event: "whatsapp_customer_failed", connection: conn.id, from: maskNumber(m.from), error: e instanceof Error ? e.message.slice(0, 160) : "unknown" }));
        }
      }
    });
  }
  return NextResponse.json({ ok: true });
}
