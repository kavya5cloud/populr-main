import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/throttle";
import { keyStore } from "@/lib/mcp/keys";
import { handle, isNotification, RPC, type JsonRpcRequest } from "@/lib/mcp/server";
import { autopilotStore } from "@/lib/seo/autopilot-store";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/mcp — Populr's MCP server (Streamable HTTP, stateless).
//
//   claude mcp add --transport http populr https://www.trypopulr.in/api/mcp \
//     --header "Authorization: Bearer pop_…"
//
// Authenticated by an access key created in Populr. The key decides the workspace; nothing in
// the request can name a different one. Each key is rate limited on its own.

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

function unauthorized(message: string) {
  return new NextResponse(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message } }), {
    status: 401,
    headers: { ...JSON_HEADERS, "WWW-Authenticate": 'Bearer realm="populr", error="invalid_token"' },
  });
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!key) return unauthorized("Missing access key. Create one in Populr → SEO autopilot → Use in your code editor, and send it as Authorization: Bearer <key>.");

  const workspace = await keyStore().resolve(key, Date.now()).catch(() => null);
  if (!workspace) return unauthorized("That access key isn't valid. It may have been revoked.");

  // Per key, not per IP: an assistant can make many calls in a burst, and one leaked key
  // shouldn't be able to run unbounded fetches through Populr.
  const limit = rateLimit(`mcp:${workspace}:${key.slice(-8)}`, 60, 60_000);
  if (!limit.allowed) {
    return new NextResponse(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32002, message: `Rate limited. Try again in ${limit.retryAfter}s.` } }), { status: 429, headers: { ...JSON_HEADERS, "Retry-After": String(limit.retryAfter) } });
  }

  let msg: JsonRpcRequest;
  try { msg = await req.json(); } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: RPC.PARSE, message: "Parse error" } }, { status: 400, headers: JSON_HEADERS });
  }
  if (Array.isArray(msg)) {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: RPC.INVALID, message: "Batch requests are not supported" } }, { status: 400, headers: JSON_HEADERS });
  }

  // Notifications (no id) get 202 and no body, per the transport spec.
  if (isNotification(msg)) return new NextResponse(null, { status: 202 });

  const res = await handle(msg, workspace, { autopilot: autopilotStore() });
  return NextResponse.json(res, { headers: JSON_HEADERS });
}

// No server-initiated stream: this server only answers requests.
export async function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
export async function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
