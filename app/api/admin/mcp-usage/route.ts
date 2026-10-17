import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/admin";
import { summarize, usageStore } from "@/lib/mcp/usage";

export const runtime = "nodejs";

// GET /api/admin/mcp-usage?days=30 — the MCP adoption funnel and daily use. ADMIN_EMAILS only.

export async function GET(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get("days")) || 30, 1), 365);
  const since = Date.now() - days * 86_400_000;
  const sinceDay = new Date(since).toISOString().slice(0, 10);

  const summary = summarize(await usageStore().rows(sinceDay), sinceDay);

  // The top of the funnel lives in api_keys. Counts only.
  let keys: { total: number; used: number; workspaces: number; createdInWindow: number } | null = null;
  const sql = db();
  if (sql) {
    try {
      const [r] = (await sql`
        SELECT count(*)::int AS total, count(last_used_at)::int AS used,
               count(DISTINCT workspace)::int AS workspaces,
               count(*) FILTER (WHERE created_at >= ${since})::int AS created_in_window
        FROM api_keys`) as { total: number; used: number; workspaces: number; created_in_window: number }[];
      keys = { total: r.total, used: r.used, workspaces: r.workspaces, createdInWindow: r.created_in_window };
    } catch {
      keys = null; // no keys table yet
    }
  }
  return NextResponse.json({ ok: true, days, keys, ...summary }, { headers: { "Cache-Control": "no-store" } });
}
