import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { NeonMediaRepo } from "@/lib/content/media";
import { storage, isValidKey } from "@/lib/creative/storage";

export const runtime = "nodejs";

// Serving a stored creative asset.
//
// The blob store is private, so its URL is never handed to a browser. Bytes leave through
// this route and only this route, which means the workspace check below is not one of
// several defences — it is the defence. A public blob URL would be an unexpirable,
// unrevocable bearer token for someone else's video.
//
// The asset id is a media_assets row id, and ownership comes from that row. Nothing is
// derived from the storage key: the key contains a hash of the workspace, but reading
// ownership out of a path is how directory traversal turns into data access.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 120 : 20, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const sql = db();
  if (!sql) return NextResponse.json({ error: "no_database" }, { status: 503 });

  const key = await workspaceKey(req.nextUrl.searchParams.get("wsid"));
  if (!key) return NextResponse.json({ error: "no_key" }, { status: 400 });

  const item = await new NeonMediaRepo(sql).get(id);
  // One response for "does not exist" and "is not yours". Distinguishing them tells an
  // unauthenticated caller which asset ids are real.
  if (!item || item.workspaceKey !== key) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Only assets this engine stored are servable. A media_assets row can also hold a
  // pointer written by older code, and streaming whatever a `uri` column happens to name
  // would turn this route into an open proxy.
  if (!isValidKey(item.uri)) return NextResponse.json({ error: "not_retrievable" }, { status: 409 });

  const body = await storage().open(item.uri);
  if (!body) return NextResponse.json({ error: "asset_missing" }, { status: 410 });

  return new NextResponse(body as unknown as BodyInit, {
    headers: {
      "Content-Type": item.mime,
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `inline; filename="${item.id}.mp4"`,
      ...(item.bytes ? { "Content-Length": String(item.bytes) } : {}),
    },
  });
}
