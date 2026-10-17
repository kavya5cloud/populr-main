import { NextRequest } from "next/server";
import { json, preflight, readForm } from "@/lib/oauth/http";
import { revoke } from "@/lib/oauth/service";
import { oauthStore } from "@/lib/oauth/store";

export const runtime = "nodejs";

// RFC 7009 token revocation. Always 200: whether a token existed isn't the caller's business.
export async function POST(req: NextRequest) {
  const f = await readForm(req);
  await revoke(f.token, f.client_id, oauthStore(), Date.now()).catch(() => undefined);
  return json({});
}
export const OPTIONS = preflight;
