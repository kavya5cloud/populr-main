import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { chatLink, cloudConfig, displayNumber } from "@/lib/whatsapp/cloud";
import { maskNumber } from "@/lib/whatsapp/links";
import { whatsappStore } from "@/lib/whatsapp/shared";

export const runtime = "nodejs";

// Connecting a founder's WhatsApp to their workspace, from Settings.
//
//   GET     whether WhatsApp is set up on Populr's side, and which number (masked) is linked
//   POST    a fresh one-time code, and a wa.me link with "link <code>" already typed
//   DELETE  disconnect

async function workspace(req: NextRequest, wsid: string | null) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 30 : 10, 60_000);
  if (!limit.allowed) return { error: NextResponse.json({ error: "rate_limited" }, { status: 429 }) };
  const ws = await workspaceKey(wsid);
  return ws ? { ws } : { error: NextResponse.json({ error: "no_key" }, { status: 400 }) };
}

export async function GET(req: NextRequest) {
  const r = await workspace(req, req.nextUrl.searchParams.get("wsid"));
  if ("error" in r) return r.error;
  const link = await whatsappStore().byWorkspace(r.ws);
  return NextResponse.json({
    ok: true,
    available: Boolean(cloudConfig() && displayNumber()),
    linked: link ? maskNumber(link.waId) : null,
    number: displayNumber() ? `+${displayNumber()}` : null,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { wsid?: string };
  const r = await workspace(req, body.wsid ?? null);
  if ("error" in r) return r.error;
  if (!cloudConfig() || !displayNumber()) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const code = await whatsappStore().createCode(r.ws, Date.now());
  return NextResponse.json({ ok: true, code, link: chatLink(`link ${code}`), expiresInMinutes: 15 });
}

export async function DELETE(req: NextRequest) {
  const r = await workspace(req, req.nextUrl.searchParams.get("wsid"));
  if ("error" in r) return r.error;
  const store = whatsappStore();
  const link = await store.byWorkspace(r.ws);
  if (link) await store.unlink(link.waId);
  return NextResponse.json({ ok: true });
}
