import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { keyStore } from "@/lib/mcp/keys";

export const runtime = "nodejs";

// Access keys for the MCP server and editor extension, from inside Populr.
//
//   GET     this workspace's keys (name, first characters, created, last used — never the key)
//   POST    { name } — a new key, returned once in full and never again
//   DELETE  ?id= — revoke

// Listing is cheap and the keys page re-reads it while open, so reads get their own, looser
// limit — sharing one with create/revoke meant an open page could lock itself out.
async function ws(req: NextRequest, wsid: string | null, write = false): Promise<{ error: NextResponse } | { w: string }> {
  const session = await getSession();
  const who = requestKey(req.headers, session?.userId);
  const limit = write
    ? rateLimit(`mcpkeys:w:${who}`, session ? 30 : 10, 60_000)
    : rateLimit(`mcpkeys:r:${who}`, session ? 120 : 60, 60_000);
  if (!limit.allowed) return { error: NextResponse.json({ error: "rate_limited" }, { status: 429 }) };
  const w = await workspaceKey(wsid);
  return w ? { w } : { error: NextResponse.json({ error: "no_key" }, { status: 400 }) };
}

export async function GET(req: NextRequest) {
  const r = await ws(req, req.nextUrl.searchParams.get("wsid"));
  if ("error" in r) return r.error;
  return NextResponse.json({ ok: true, keys: await keyStore().list(r.w) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({})) as { wsid?: string; name?: string };
  const r = await ws(req, b.wsid ?? null, true);
  if ("error" in r) return r.error;
  const name = String(b.name ?? "").trim().slice(0, 60) || "Code editor";
  const created = await keyStore().create(r.w, name, Date.now());
  if (!created) return NextResponse.json({ error: "too_many_keys", detail: "This workspace already has 10 keys. Revoke one first." }, { status: 400 });
  return NextResponse.json({ ok: true, key: created.key, record: created.record }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(req: NextRequest) {
  const r = await ws(req, req.nextUrl.searchParams.get("wsid"), true);
  if ("error" in r) return r.error;
  const ok = await keyStore().revoke(r.w, req.nextUrl.searchParams.get("id") ?? "");
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
