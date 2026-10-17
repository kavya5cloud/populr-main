import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// OAuth 2.1 for Populr's MCP server — "Sign in with Populr" instead of copying a key.
//
// Populr is both the authorization server and the resource server (/api/mcp). Clients are
// editors (Claude Code, VS Code, Cursor…): public clients, so no client secrets — PKCE (S256)
// is required on every authorization, codes are single-use and short-lived, refresh tokens
// rotate, and a reused one revokes its whole family. Tokens are stored as SHA-256 hashes,
// like access keys. See the MCP authorization spec and RFCs 6749, 7591, 7636, 8414, 8707, 9728.

export const ISSUER = "https://www.trypopulr.in";
export const MCP_RESOURCE = `${ISSUER}/api/mcp`;

/**
 * The issuer for a request. Production is always the canonical address — a forged Host header
 * can't change who issues tokens. Elsewhere it's the request's own origin, so the whole flow
 * can be exercised against a local server.
 */
export function issuerFor(origin?: string): string {
  return process.env.NODE_ENV === "production" || !origin ? ISSUER : origin.replace(/\/$/, "");
}
export const resourceFor = (issuer: string) => `${issuer}/api/mcp`;
export const SCOPE = "seo";
export const ACCESS_TTL_MS = 60 * 60_000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;
export const CODE_TTL_MS = 5 * 60_000;

export const ACCESS_PREFIX = "poa_";
export const REFRESH_PREFIX = "por_";

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
export const newSecret = (prefix: string) => prefix + randomBytes(32).toString("base64url");
export const newClientId = () => "pcl_" + randomBytes(16).toString("base64url");

// ── Metadata documents ────────────────────────────────────────────────────────────────

export function protectedResourceMetadata(issuer = ISSUER) {
  return {
    resource: resourceFor(issuer),
    authorization_servers: [issuer],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Populr SEO",
    resource_documentation: `${issuer}/developers/docs`,
  };
}

export function authorizationServerMetadata(issuer = ISSUER) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    registration_endpoint: `${issuer}/api/oauth/register`,
    revocation_endpoint: `${issuer}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE],
    service_documentation: `${issuer}/developers/docs`,
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
}

/** The WWW-Authenticate header that tells an MCP client where to start signing in. */
export function wwwAuthenticate(error?: "invalid_token", issuer = ISSUER) {
  return `Bearer realm="populr", resource_metadata="${issuer}/.well-known/oauth-protected-resource"${error ? `, error="${error}"` : ""}`;
}

// ── Redirect URIs ─────────────────────────────────────────────────────────────────────

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const BANNED_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "about:", "blob:", "filesystem:", "ftp:", "ws:", "wss:"]);

/**
 * Whether a client may register this redirect URI: HTTPS, http on the loopback interface
 * (native apps, RFC 8252), or a private-use scheme like cursor:// or vscode:// — never a
 * scheme that runs code or reads files, and never a fragment.
 */
export function acceptableRedirectUri(raw: string): boolean {
  if (typeof raw !== "string" || raw.length > 500) return false;
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.hash || u.username || u.password) return false;
  if (BANNED_SCHEMES.has(u.protocol)) return false;
  if (u.protocol === "https:") return !!u.hostname;
  if (u.protocol === "http:") return LOOPBACK.has(u.hostname);
  // Private-use scheme: reverse-domain style or an app's own scheme (cursor://, vscode://).
  return /^[a-z][a-z0-9+.-]*:$/.test(u.protocol);
}

/**
 * Whether the redirect_uri in a request matches one the client registered. Exact match,
 * except that a loopback http URI may use any port (RFC 8252 §7.3): native apps pick a free
 * port at run time.
 */
export function redirectMatches(registered: string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  let r: URL;
  try { r = new URL(requested); } catch { return false; }
  if (r.protocol !== "http:" || !LOOPBACK.has(r.hostname)) return false;
  return registered.some((reg) => {
    try {
      const g = new URL(reg);
      return g.protocol === "http:" && g.hostname === r.hostname && g.pathname === r.pathname && g.search === r.search;
    } catch { return false; }
  });
}

// ── PKCE ──────────────────────────────────────────────────────────────────────────────

const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE_RE = /^[A-Za-z0-9\-_]{43}$/;

export const validChallenge = (c: unknown): c is string => typeof c === "string" && CHALLENGE_RE.test(c);

export function pkceMatches(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== "string" || !VERIFIER_RE.test(verifier)) return false;
  const computed = createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(computed), b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** RFC 8707: a resource indicator, when sent, must name this MCP server. */
export function resourceOk(resource: unknown, issuer = ISSUER): boolean {
  if (resource === undefined || resource === null || resource === "") return true;
  if (typeof resource !== "string") return false;
  return resource.replace(/\/$/, "") === resourceFor(issuer);
}

/** The address a client name gets shown with on the consent screen, so a look-alike name can't hide where it sends you. */
export function redirectLabel(uri: string): string {
  try {
    const u = new URL(uri);
    if (u.protocol === "http:" || u.protocol === "https:") return u.host;
    return `${u.protocol}//`;
  } catch { return uri.slice(0, 60); }
}
