import { createHmac, timingSafeEqual } from "node:crypto";

// The WhatsApp Cloud API, Meta's hosted WhatsApp Business platform.
//
// Populr has one business number of its own, which founders message to approve posts and
// ask questions. Configuration (all from Meta's developer dashboard, WhatsApp → API setup):
//
//   WHATSAPP_TOKEN            a System User access token with whatsapp_business_messaging
//   WHATSAPP_PHONE_NUMBER_ID  the sending number's ID (not the phone number itself)
//   WHATSAPP_APP_SECRET       the app secret, which signs every webhook delivery
//   WHATSAPP_VERIFY_TOKEN     any string you choose; Meta echoes it when registering the webhook
//   WHATSAPP_DISPLAY_NUMBER   the number founders message, digits with country code (919876543210)
//   WHATSAPP_GRAPH_VERSION    optional, defaults below
//
// Nothing in this file decides what to say. It sends, and it proves a delivery came from Meta.

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v23.0";
/** WhatsApp's own ceiling on a text message body. */
export const MAX_TEXT = 4096;

export type CloudConfig = { token: string; phoneNumberId: string };

export function cloudConfig(): CloudConfig | null {
  const token = process.env.WHATSAPP_TOKEN, phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  return token && phoneNumberId ? { token, phoneNumberId } : null;
}

export function displayNumber(): string | null {
  const n = (process.env.WHATSAPP_DISPLAY_NUMBER || "").replace(/\D/g, "");
  return n || null;
}

/** A wa.me link that opens WhatsApp with the message already typed. */
export function chatLink(text: string): string | null {
  const n = displayNumber();
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}

export class WhatsAppSendError extends Error {
  constructor(readonly status: number, readonly code: number | null, message: string) { super(message); this.name = "WhatsAppSendError"; }
}

async function post(cfg: CloudConfig, payload: Record<string, unknown>, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(`https://graph.facebook.com/${GRAPH_VERSION}/${cfg.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
    signal: AbortSignal.timeout(10_000),
  });
  const j = await res.json().catch(() => ({})) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
  if (!res.ok || !j.messages?.[0]?.id) {
    // 131047 is "outside the 24-hour window": a free-form message to someone who hasn't
    // written in a day. Named, because it's the one callers have to handle differently —
    // by sending an approved template instead.
    throw new WhatsAppSendError(res.status, j.error?.code ?? null, j.error?.message ?? `HTTP ${res.status}`);
  }
  return j.messages[0].id;
}

/** A plain text reply. Only allowed within 24 hours of the person's last message. */
export function sendText(cfg: CloudConfig, to: string, body: string, fetchImpl?: typeof fetch): Promise<string> {
  const text = body.length > MAX_TEXT ? `${body.slice(0, MAX_TEXT - 1)}…` : body;
  return post(cfg, { to, type: "text", text: { body: text, preview_url: false } }, fetchImpl);
}

/**
 * A pre-approved template. The only way to start a conversation, or to message someone
 * whose last message was more than 24 hours ago. Templates are written and approved in
 * Meta's WhatsApp Manager before they can be sent; `params` fill the body's {{1}}, {{2}}…
 */
export function sendTemplate(cfg: CloudConfig, to: string, name: string, language: string, params: string[], fetchImpl?: typeof fetch): Promise<string> {
  return post(cfg, {
    to, type: "template",
    template: {
      name, language: { code: language },
      ...(params.length ? { components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text: text.slice(0, 1000) })) }] } : {}),
    },
  }, fetchImpl);
}

/**
 * Whether a webhook delivery really came from Meta.
 *
 * Meta signs the raw request body with the app secret and sends the result as
 * X-Hub-Signature-256: sha256=<hex>. Without this check anyone who finds the URL can post a
 * fake "approve all" from any number. Compared in constant time; the body has to be the raw
 * bytes, because re-serialised JSON will not match.
 */
export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const given = Buffer.from(header.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type InboundMessage = {
  id: string;
  /** The sender's WhatsApp ID — their number, digits only, with country code. */
  from: string;
  text: string;
  at: number;
};

/**
 * Text out of a webhook payload. Button and list replies count as text — they are how a
 * founder taps "Approve" — and everything else (images, voice notes, reactions, delivery
 * receipts) is ignored rather than guessed at.
 */
export function parseInbound(payload: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  const entries = (payload as { entry?: { changes?: { value?: { messages?: unknown[] } }[] }[] })?.entry ?? [];
  for (const e of entries) for (const c of e.changes ?? []) for (const raw of c.value?.messages ?? []) {
    const m = raw as {
      id?: string; from?: string; timestamp?: string; type?: string;
      text?: { body?: string };
      button?: { text?: string };
      interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
    };
    const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title;
    if (!m.id || !m.from || !text) continue;
    out.push({ id: m.id, from: m.from.replace(/\D/g, ""), text: text.trim(), at: Number(m.timestamp ?? 0) * 1000 });
  }
  return out;
}
