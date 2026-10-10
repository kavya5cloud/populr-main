import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// Fetching a URL that came from outside.
//
// Market research fetches competitor sites and feeds that customers type in. Handed
// straight to fetch(), a URL like http://169.254.169.254/ or http://localhost:5432/ turns
// the server into a proxy for its own private network — server-side request forgery. This
// is the one path all such fetches go through.
//
// What it enforces:
//   - http and https only
//   - the host must resolve to public addresses only (checked on every redirect hop,
//     because a public URL redirecting to a private one is the standard way round a
//     check made once)
//   - a hard timeout and a byte cap, so a slow or endless response cannot hold a function
//
// What it does not: a DNS answer can change between this lookup and the connection fetch()
// makes (rebinding). Closing that needs pinning the resolved address into the connection,
// which fetch() does not expose. This removes the direct cases, which are nearly all of them.

export class UnsafeUrlError extends Error {
  constructor(message: string) { super(message); this.name = "UnsafeUrlError"; }
}

/** True for any address a public fetch has no business reaching. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||     // carrier-grade NAT
      (a === 169 && b === 254) ||               // link-local, incl. cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||  // benchmarking
      a >= 224                                  // multicast and reserved
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));   // v4-mapped
  return (
    v6 === "::" || v6 === "::1" ||
    v6.startsWith("fc") || v6.startsWith("fd") ||                         // unique local
    v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb") ||
    v6.startsWith("ff")                                                   // multicast
  );
}

async function assertPublic(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new UnsafeUrlError("not a valid URL"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new UnsafeUrlError(`${u.protocol} is not allowed`);
  if (u.username || u.password) throw new UnsafeUrlError("credentials in a URL are not allowed");

  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new UnsafeUrlError("private host");
  }
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true })).map((r) => r.address);
  if (!addrs.length || addrs.some(isPrivateAddress)) throw new UnsafeUrlError("resolves to a private address");
  return u;
}

export type SafeFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
};

/** Fetch a public URL and return its body as text. Throws on anything unsafe or oversized. */
export async function safeFetchText(raw: string, opts: SafeFetchOptions = {}): Promise<{ url: string; status: number; text: string }> {
  const timeoutMs = opts.timeoutMs ?? 6_000;
  const maxBytes = opts.maxBytes ?? 1_500_000;
  const maxRedirects = opts.maxRedirects ?? 3;
  const deadline = AbortSignal.timeout(timeoutMs);

  let current = raw;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const u = await assertPublic(current);
    const res = await fetch(u, {
      redirect: "manual",
      signal: deadline,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PopulrResearch/1.0; +https://www.trypopulr.in)", ...opts.headers },
    });

    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) throw new UnsafeUrlError("redirect without a location");
      current = new URL(next, u).toString();
      continue;   // re-checked at the top of the loop, not trusted because the first hop was
    }

    // Read with a cap rather than res.text(), which buffers whatever the server sends.
    const reader = res.body?.getReader();
    if (!reader) return { url: u.toString(), status: res.status, text: "" };
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new UnsafeUrlError("response too large"); }
      chunks.push(value);
    }
    const body = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { body.set(c, off); off += c.byteLength; }
    return { url: u.toString(), status: res.status, text: new TextDecoder().decode(body) };
  }
  throw new UnsafeUrlError("too many redirects");
}
