import { NextRequest, NextResponse } from "next/server";
import { cloudConfig, sendTemplate } from "@/lib/whatsapp/cloud";
import { digestTemplate, sendDigests } from "@/lib/whatsapp/digest";
import { assistantDeps } from "@/lib/whatsapp/shared";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET /api/cron/whatsapp-digest — the morning WhatsApp message, for whoever is due.
//
// Called on the publish workflow's ten-minute beat; the endpoint decides who is due, so
// calling it often costs nothing and a missed window is caught on the next tick.

function authCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (req.headers.get("x-vercel-cron")) return true;
  if (!secret) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const cfg = cloudConfig();
  if (!cfg) return NextResponse.json({ ok: true, note: "whatsapp not configured" });

  const { name, language } = digestTemplate();
  const started = Date.now();
  const result = await sendDigests(
    assistantDeps(),
    (to, count) => sendTemplate(cfg, to, name, language, [String(count)]),
    started + 45_000,
  );
  console.info(JSON.stringify({ event: "whatsapp_digest", ...result }));
  return NextResponse.json({ ok: true, ...result });
}
