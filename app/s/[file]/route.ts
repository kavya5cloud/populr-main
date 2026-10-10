import { NextRequest } from "next/server";
import { renderSnippet } from "@/lib/seo/autopilot";
import { autopilotStore } from "@/lib/seo/autopilot-store";

export const runtime = "nodejs";

// GET /s/<siteKey>.js — the script on the customer's site.
//
// Cached for five minutes at the edge, so a busy site costs one render every five minutes
// rather than one per page view, and an approval in Populr reaches the site within that.
// An unknown key returns a harmless comment, not an error page: a 404 would show up as a
// broken script in the customer's browser console and look like their site is broken.

const JS = { "Content-Type": "application/javascript; charset=utf-8", "X-Content-Type-Options": "nosniff" };

export async function GET(req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const key = file.replace(/\.js$/, "");
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(key)) {
    return new Response("/* not a Populr snippet */", { status: 200, headers: { ...JS, "Cache-Control": "public, max-age=3600" } });
  }
  const cfg = await autopilotStore().byKey(key).catch(() => null);
  // The install check reports back to whichever host served this script, not a configured
  // address — the two differ in preview deployments and locally, and a beacon sent to the
  // wrong host is an install that never shows as installed.
  const body = cfg ? renderSnippet(cfg, req.nextUrl.origin) : "/* This Populr snippet is no longer connected to a site. */";
  return new Response(body, {
    status: 200,
    headers: { ...JS, "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600" },
  });
}
