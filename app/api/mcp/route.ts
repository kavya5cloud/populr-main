import { after, NextRequest, NextResponse } from "next/server";
import { rateLimit, requestKey } from "@/lib/throttle";
import { keyStore } from "@/lib/mcp/keys";
import { db } from "@/lib/db";
import { handle, isNotification, RPC, type JsonRpcRequest } from "@/lib/mcp/server";
import { usageEvent, usageStore } from "@/lib/mcp/usage";
import { autopilotStore } from "@/lib/seo/autopilot-store";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/mcp — Populr's MCP server (Streamable HTTP, stateless).
//
//   claude mcp add --transport http populr https://www.trypopulr.in/api/mcp \
//     --header "Authorization: Bearer pop_…"
//
// Authenticated by an access key created in Populr. The key decides the workspace; nothing in
// the request can name a different one. Each key is rate limited on its own; requests with no
// key can only describe the server (see NEEDS_KEY), and are rate limited by address.

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

function unauthorized(message: string) {
  return new NextResponse(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message } }), {
    status: 401,
    headers: { ...JSON_HEADERS, "WWW-Authenticate": 'Bearer realm="populr", error="invalid_token"' },
  });
}

// Only running a tool needs a key: tools/call is the one method that reads a workspace.
// Everything else — initialize, ping, tools/list, prompts, the (empty) resource lists, and
// methods Populr doesn't support — describes the server, which the docs already publish. So
// directories (the MCP Registry's clients, Smithery) can scan it, and an editor can show the
// tools before a key is set up. Unsupported methods get "method not found", not a 401 that a
// gateway would turn into a sign-in prompt.
const NEEDS_KEY = new Set(["tools/call"]);

const MISSING_KEY = "Missing access key. Create one at https://www.trypopulr.in/app/keys and send it as Authorization: Bearer <key>.";

// The key, from `Authorization: Bearer <key>` or `X-Populr-Key: <key>` — the second for
// gateways that pass a header through but can't add the "Bearer " prefix (Smithery).
function keyFrom(headers: Headers): string {
  const auth = headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return (headers.get("x-populr-key") ?? "").trim();
}

function rateLimited(retryAfter: number) {
  return new NextResponse(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32002, message: `Rate limited. Try again in ${retryAfter}s.` } }), { status: 429, headers: { ...JSON_HEADERS, "Retry-After": String(retryAfter) } });
}

export async function POST(req: NextRequest) {
  const key = keyFrom(req.headers);
  let workspace: string | null = null;

  if (key) {
    // A key that's presented must be valid, even for discovery — a revoked key should say so.
    workspace = await keyStore().resolve(key, Date.now()).catch(() => null);
    if (!workspace) return unauthorized("That access key isn't valid. It may have been revoked.");
    // Keys belong to accounts. One made signed out, before that rule, resolves to a browser
    // workspace nobody can see or revoke any more — so it stops working. (Without a
    // database there are no accounts, and the browser workspace still stands in.)
    if (workspace.startsWith("anon:") && db()) {
      return unauthorized("This key was created without signing in, and keys now belong to an account. Sign in at https://www.trypopulr.in/app/keys and create a new one.");
    }
    // Per key, not per IP: an assistant can make many calls in a burst, and one leaked key
    // shouldn't be able to run unbounded fetches through Populr.
    const limit = rateLimit(`mcp:${workspace}:${key.slice(-8)}`, 60, 60_000);
    if (!limit.allowed) return rateLimited(limit.retryAfter);
  } else {
    const limit = rateLimit(`mcp:anon:${requestKey(req.headers)}`, 30, 60_000);
    if (!limit.allowed) return rateLimited(limit.retryAfter);
  }

  let msg: JsonRpcRequest;
  try { msg = await req.json(); } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: RPC.PARSE, message: "Parse error" } }, { status: 400, headers: JSON_HEADERS });
  }
  if (Array.isArray(msg)) {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: RPC.INVALID, message: "Batch requests are not supported" } }, { status: 400, headers: JSON_HEADERS });
  }
  if (!msg || typeof msg !== "object") {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: RPC.INVALID, message: "Invalid JSON-RPC request" } }, { status: 400, headers: JSON_HEADERS });
  }

  // Notifications (no id) get 202 and no body, per the transport spec.
  if (isNotification(msg)) return new NextResponse(null, { status: 202 });

  if (!workspace && NEEDS_KEY.has(msg.method)) return unauthorized(MISSING_KEY);

  const res = await handle(msg, workspace ?? "", { autopilot: autopilotStore() });
  // Counted after the response is sent, so it never slows a call or fails one.
  const event = usageEvent(msg, res, workspace);
  const count = () => usageStore().record(event, Date.now()).catch(() => undefined);
  try { after(count); } catch { void count(); } // after() needs a request scope; tests have none
  return NextResponse.json(res, { headers: JSON_HEADERS });
}

// No server-initiated stream: this server only answers requests.
export async function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
export async function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
