import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { workspaceKey } from "@/lib/intel";
import { oauthStore } from "@/lib/oauth/store";

export const runtime = "nodejs";

// The apps connected with "Sign in with Populr", for the keys page. GET lists; DELETE ?family=
// signs one out (every token from that sign-in stops working at once).

async function workspace(req: NextRequest): Promise<string | NextResponse> {
  const session = await getSession();
  if (!session && db()) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });
  const w = await workspaceKey(req.nextUrl.searchParams.get("wsid"));
  return w ?? NextResponse.json({ error: "no_key" }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const w = await workspace(req);
  if (typeof w !== "string") return w;
  return NextResponse.json({ ok: true, apps: await oauthStore().grants(w, Date.now()) }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(req: NextRequest) {
  if (req.headers.get("origin") && req.headers.get("origin") !== req.nextUrl.origin) return NextResponse.json({ error: "bad_origin" }, { status: 403 });
  const w = await workspace(req);
  if (typeof w !== "string") return w;
  const family = req.nextUrl.searchParams.get("family") ?? "";
  const n = await oauthStore().revokeFamily(family, Date.now(), w);
  return NextResponse.json({ ok: n > 0 }, { status: n > 0 ? 200 : 404 });
}
