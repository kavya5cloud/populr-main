import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { forwardLine } from "./core";

// A local MCP server over stdio that relays to Populr's HTTP server, adding the access key.
//
// Cursor runs this (see extension.ts) because its extension API can't send headers to a
// remote server. The key and URL arrive in the environment — never as arguments, which show
// up in process listings — and nothing here logs either.

const url = process.env.POPULR_URL ?? "";
const key = process.env.POPULR_KEY ?? "";
if (!url || !key) {
  process.stderr.write("Populr: not connected. Run \"Populr: Connect\" in the editor.\n");
  process.exit(1);
}

// The extension writes a one-time token to this file while connected, and deletes it on
// disconnect. If it's gone or different, this relay is stale: stop, and take the key with it.
const sessionFile = process.env.POPULR_SESSION_FILE;
const session = process.env.POPULR_SESSION;
const live = () => {
  if (!sessionFile || !session) return true;
  try { return readFileSync(sessionFile, "utf8") === session; } catch { return false; }
};
setInterval(() => { if (!live()) process.exit(0); }, 2000).unref();

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
let pending = 0;
let closed = false;
const done = () => { if (closed && pending === 0) process.exit(0); };

rl.on("line", (line) => {
  if (!line.trim()) return;
  if (!live()) {
    let id: unknown = null;
    try { id = JSON.parse(line)?.id ?? null; } catch { /* not JSON */ }
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32001, message: "Populr is disconnected in the editor. Run \"Populr: Connect\"." } }) + "\n", () => process.exit(0));
    return;
  }
  pending++;
  // Requests run concurrently — JSON-RPC responses are matched by id, and an audit that takes
  // a few seconds shouldn't hold up a quick status check.
  forwardLine(url, key, line)
    .then((out) => { if (out) process.stdout.write(out + "\n"); })
    .catch(() => process.stderr.write("Populr: a request failed.\n"))
    .finally(() => { pending--; done(); });
});
rl.on("close", () => { closed = true; done(); });
