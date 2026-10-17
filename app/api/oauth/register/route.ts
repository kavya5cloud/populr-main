import { NextRequest } from "next/server";
import { rateLimit, requestKey } from "@/lib/throttle";
import { json, preflight } from "@/lib/oauth/http";
import { registerClient } from "@/lib/oauth/service";
import { oauthStore } from "@/lib/oauth/store";

export const runtime = "nodejs";

// RFC 7591 dynamic client registration: an editor registers itself before its first sign-in.
export async function POST(req: NextRequest) {
  const limit = rateLimit(`oauth:register:${requestKey(req.headers)}`, 20, 60 * 60_000);
  if (!limit.allowed) return json({ error: "slow_down", error_description: "Too many registrations. Try again later." }, 429);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return json({ error: "invalid_client_metadata", error_description: "Send the client metadata as JSON." }, 400);
  const r = await registerClient(body, oauthStore(), Date.now());
  return json(r.body, r.status);
}
export const OPTIONS = preflight;
