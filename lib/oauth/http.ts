import { NextResponse } from "next/server";

// Shared by the OAuth endpoints. They're called by editors and, for browser-based MCP clients,
// from other origins — so CORS is open (no cookies are involved), and nothing is cached.

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

export const json = (body: unknown, status = 200, cache = "no-store") =>
  NextResponse.json(body, { status, headers: { ...CORS, "Cache-Control": cache, Pragma: "no-cache" } });

export const preflight = () => new NextResponse(null, { status: 204, headers: CORS });

/** Form-encoded (the standard) or JSON (some clients) into a flat record of strings. */
export async function readForm(req: Request): Promise<Record<string, string | undefined>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, typeof v === "string" ? v : undefined]));
  }
  const text = await req.text().catch(() => "");
  return Object.fromEntries(new URLSearchParams(text));
}
