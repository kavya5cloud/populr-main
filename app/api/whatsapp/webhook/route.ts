import { NextRequest, NextResponse, after } from "next/server";
import { cloudConfig, parseInbound, sendText, verifySignature, WhatsAppSendError } from "@/lib/whatsapp/cloud";
import { handleInbound } from "@/lib/whatsapp/assistant";
import { assistantDeps } from "@/lib/whatsapp/shared";
import { maskNumber } from "@/lib/whatsapp/links";

export const runtime = "nodejs";
export const maxDuration = 60;

// The WhatsApp webhook. Register it in Meta's dashboard as
//   https://www.trypopulr.in/api/whatsapp/webhook
// with WHATSAPP_VERIFY_TOKEN as the verify token, subscribed to the `messages` field.

/** Meta's one-time handshake when the webhook is registered. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (expected && p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === expected) {
    return new Response(p.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("forbidden", { status: 403 });
}

/**
 * Inbound messages.
 *
 * Answered 200 at once and handled after the response: Meta redelivers anything not
 * acknowledged within a few seconds, and a market question takes the research agents
 * longer than that. Redeliveries that do happen are dropped by message id.
 *
 * Nothing a founder writes is logged — only that a message arrived, from which masked
 * number, and whether the reply went out.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  }

  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ ok: true }); }
  const messages = parseInbound(payload);
  const cfg = cloudConfig();

  if (messages.length && cfg) {
    after(async () => {
      const deps = assistantDeps();
      for (const m of messages) {
        try {
          if (!(await deps.store.firstSeen(m.id, Date.now()))) continue;
          const reply = await handleInbound(m, deps);
          if (reply) await sendText(cfg, m.from, reply);
          console.info(JSON.stringify({ event: "whatsapp_reply", to: maskNumber(m.from), replied: !!reply }));
        } catch (e) {
          console.warn(JSON.stringify({
            event: "whatsapp_reply_failed", to: maskNumber(m.from),
            code: e instanceof WhatsAppSendError ? e.code : null,
            error: e instanceof Error ? e.message.slice(0, 160) : "unknown",
          }));
        }
      }
    });
  }
  return NextResponse.json({ ok: true });
}
