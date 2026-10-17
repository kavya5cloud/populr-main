import { NextRequest } from "next/server";
import { rateLimit, requestKey } from "@/lib/throttle";
import { json, preflight, readForm } from "@/lib/oauth/http";
import { token } from "@/lib/oauth/service";
import { issuerFor } from "@/lib/oauth/core";
import { oauthStore } from "@/lib/oauth/store";

export const runtime = "nodejs";

// The token endpoint: an authorization code (with its PKCE verifier) or a refresh token in,
// an access token and a new refresh token out.
export async function POST(req: NextRequest) {
  const limit = rateLimit(`oauth:token:${requestKey(req.headers)}`, 60, 60_000);
  if (!limit.allowed) return json({ error: "slow_down", error_description: "Too many requests." }, 429);
  const r = await token(await readForm(req), oauthStore(), Date.now(), issuerFor(req.nextUrl.origin));
  return json(r.body, r.status);
}
export const OPTIONS = preflight;
