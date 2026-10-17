import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { workspaceKey } from "@/lib/intel";
import { rateLimit, requestKey } from "@/lib/throttle";
import { approve, checkAuthorize, deny, type AuthorizeParams } from "@/lib/oauth/service";
import { issuerFor } from "@/lib/oauth/core";
import { oauthStore } from "@/lib/oauth/store";

export const runtime = "nodejs";

// POST /api/oauth/authorize — the consent screen's Allow / Cancel.
//
// Only from Populr's own page (Origin must match): a cross-site page can't make a signed-in
// user approve. The request is checked again here rather than trusted from the page, and the
// answer is where to send the browser — a code on Allow, access_denied on Cancel.

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== req.nextUrl.origin) return NextResponse.json({ error: "bad_origin" }, { status: 403, headers: NO_STORE });
  const b = (await req.json().catch(() => ({}))) as { params?: AuthorizeParams; decision?: string; wsid?: string };
  const params = Object.fromEntries(Object.entries(b.params ?? {}).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 2000) : undefined]));

  const now = Date.now();
  const check = await checkAuthorize(params, oauthStore(), now, undefined, issuerFor(req.nextUrl.origin));
  if (!check.ok) return "show" in check ? NextResponse.json({ error: "invalid_request", message: check.show }, { status: 400, headers: NO_STORE }) : NextResponse.json({ redirect: check.redirect }, { headers: NO_STORE });
  if (b.decision !== "allow") return NextResponse.json({ redirect: deny(check) }, { headers: NO_STORE });

  const session = await getSession();
  if (!session && db()) return NextResponse.json({ error: "sign_in_required" }, { status: 401, headers: NO_STORE });
  const workspace = await workspaceKey(b.wsid);
  if (!workspace) return NextResponse.json({ error: "no_workspace" }, { status: 400, headers: NO_STORE });
  const limit = rateLimit(`oauth:approve:${session?.userId ?? requestKey(req.headers)}`, 30, 60 * 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited", message: "Too many sign-ins. Try again later." }, { status: 429, headers: NO_STORE });

  return NextResponse.json({ redirect: await approve(check, workspace, oauthStore(), now) }, { headers: NO_STORE });
}
