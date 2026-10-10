// Everything the extension does that isn't VS Code: talking to Populr's MCP server and
// shaping what comes back. No `vscode` import, so it runs (and is tested) in plain Node.

export const DEFAULT_SERVER_URL = "https://www.trypopulr.in/api/mcp";
export const KEYS_URL = "https://www.trypopulr.in/app/keys";
export const PROTOCOL_VERSION = "2025-06-18";

// pop_ + 32 random bytes, base64url — 43 characters.
const KEY_RE = /^pop_[A-Za-z0-9_-]{43}$/;

export function isKeyShaped(key: string): boolean {
  return KEY_RE.test(key.trim());
}

// The key is sent to this URL, so it has to be HTTPS. Plain HTTP is allowed only for a
// server on this machine (developing Populr itself).
export function checkServerUrl(raw: string): URL | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol === "https:") return u;
  if (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return u;
  return null;
}

export type PopulrErrorKind = "auth" | "rate" | "network" | "server";

export class PopulrError extends Error {
  constructor(readonly kind: PopulrErrorKind, message: string) {
    super(message);
  }
}

export type ToolText = { text: string; isError: boolean };
export type Fetch = typeof fetch;

let nextId = 1;

// A response is plain JSON from Populr, but the transport allows a server to answer with an
// event stream instead, so take the last JSON-RPC message from one if that's what arrives.
function parseBody(body: string, contentType: string): { result?: unknown; error?: { message?: string } } | null {
  if (contentType.includes("text/event-stream")) {
    const data = body.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
    for (let i = data.length - 1; i >= 0; i--) {
      try { return JSON.parse(data[i]); } catch { /* keep looking */ }
    }
    return null;
  }
  try { return JSON.parse(body); } catch { return null; }
}

export async function rpc(url: string, key: string, method: string, params: Record<string, unknown>, opts: { fetch?: Fetch; signal?: AbortSignal } = {}): Promise<unknown> {
  const doFetch = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": PROTOCOL_VERSION,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new PopulrError("network", "Couldn't reach Populr. Check your connection and try again.");
  }

  const msg = parseBody(await res.text(), res.headers.get("content-type") ?? "");
  if (res.status === 401) throw new PopulrError("auth", msg?.error?.message || "Populr didn't accept that access key.");
  if (res.status === 429) throw new PopulrError("rate", msg?.error?.message || "Too many requests. Try again in a minute.");
  if (!res.ok || !msg) throw new PopulrError("server", `Populr answered with an error (HTTP ${res.status}). Try again in a moment.`);
  if (msg.error) throw new PopulrError("server", msg.error.message || "Populr couldn't do that.");
  return msg.result;
}

export async function listTools(url: string, key: string, opts: { fetch?: Fetch; signal?: AbortSignal } = {}): Promise<string[]> {
  const r = (await rpc(url, key, "tools/list", {}, opts)) as { tools?: { name: string }[] };
  return (r?.tools ?? []).map((t) => t.name);
}

export async function callTool(url: string, key: string, name: string, args: Record<string, unknown>, opts: { fetch?: Fetch; signal?: AbortSignal } = {}): Promise<ToolText> {
  const r = (await rpc(url, key, "tools/call", { name, arguments: args }, opts)) as { content?: { type: string; text?: string }[]; isError?: boolean };
  const text = (r?.content ?? []).filter((c) => c.type === "text" && typeof c.text === "string").map((c) => c.text).join("\n");
  return { text, isError: !!r?.isError };
}

// generate_llms_txt answers "Save this as llms.txt at the root of … :\n\n<the file>". Anything
// else — business details not filled in, autopilot not set up — is a message for the person.
export function llmsTxtFrom(toolText: string): string | null {
  if (!toolText.startsWith("Save this as llms.txt")) return null;
  const at = toolText.indexOf("\n\n");
  if (at < 0) return null;
  const body = toolText.slice(at + 2).trim();
  return body ? body + "\n" : null;
}

const LD_RE = /<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g;

// get_structured_data returns <script type="application/ld+json"> blocks plus a note for the
// assistant. Pull out the objects so they can be written the way the open file needs them.
export function jsonLdFrom(toolText: string): unknown[] {
  const out: unknown[] = [];
  for (const m of toolText.matchAll(LD_RE)) {
    try { out.push(JSON.parse(m[1])); } catch { /* skip a block that isn't JSON */ }
  }
  return out;
}

const JSX_LANGS = new Set(["javascriptreact", "typescriptreact"]);

// In HTML (and Vue, Svelte, Astro, PHP templates) a script tag goes in as-is. In JSX it can't:
// the braces in the JSON would be read as expressions, so React's documented pattern is used.
// `<` is escaped either way so a value can never close the script tag early.
export function structuredDataSnippet(objects: unknown[], languageId: string, indent = ""): string {
  const blocks = objects.map((o) => {
    if (JSX_LANGS.has(languageId)) {
      const literal = JSON.stringify(o, null, 2).replace(/\n/g, `\n${indent}  `);
      return [
        "<script",
        `${indent}  type="application/ld+json"`,
        `${indent}  dangerouslySetInnerHTML={{ __html: JSON.stringify(${literal}).replace(/</g, "\\\\u003c") }}`,
        `${indent}/>`,
      ].join("\n");
    }
    const json = JSON.stringify(o, null, 2).replace(/</g, "\\u003c").replace(/\n/g, `\n${indent}`);
    return `<script type="application/ld+json">\n${indent}${json}\n${indent}</script>`;
  });
  return blocks.join(`\n${indent}`);
}

export function describeError(e: unknown): string {
  if (e instanceof PopulrError) return e.message;
  return "Something went wrong talking to Populr. Try again in a moment.";
}
