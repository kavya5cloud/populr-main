import { randomBytes } from "node:crypto";
import { safeFetchText } from "@/lib/net/safe-fetch";
import {
  ACCESS_PREFIX, ACCESS_TTL_MS, acceptableRedirectUri, CODE_TTL_MS, hashToken, ISSUER, newClientId, newSecret,
  pkceMatches, redirectMatches, REFRESH_PREFIX, REFRESH_TTL_MS, resourceOk, SCOPE, validChallenge,
} from "./core";
import type { OAuthClient, OAuthStore } from "./store";

// The OAuth flows, independent of HTTP: the routes parse requests and call these.

type Result = { status: number; body: Record<string, unknown> };
const oauthError = (status: number, error: string, description: string): Result => ({ status, body: { error, error_description: description } });

const cleanName = (v: unknown) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 80) : "") || "MCP client";

// ── Registration (RFC 7591) ───────────────────────────────────────────────────────────

export async function registerClient(body: Record<string, unknown>, store: OAuthStore, now: number): Promise<Result> {
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10) return oauthError(400, "invalid_redirect_uri", "redirect_uris must list 1–10 addresses.");
  if (!uris.every((u) => typeof u === "string" && acceptableRedirectUri(u))) return oauthError(400, "invalid_redirect_uri", "Redirect URIs must be https, http on localhost, or an app's own scheme.");
  const grants = Array.isArray(body.grant_types) ? body.grant_types : ["authorization_code"];
  if (!grants.includes("authorization_code")) return oauthError(400, "invalid_client_metadata", "Only the authorization_code grant (with refresh_token) is supported.");
  const client: OAuthClient = { clientId: newClientId(), name: cleanName(body.client_name), redirectUris: uris as string[], kind: "dcr", createdAt: now };
  await store.saveClient(client);
  return {
    status: 201,
    body: {
      client_id: client.clientId,
      client_id_issued_at: Math.floor(now / 1000),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      // Public clients only: editors can't keep a secret, so PKCE protects the exchange instead.
      token_endpoint_auth_method: "none",
    },
  };
}

// ── Client ID Metadata Documents (MCP 2025-11-25) ─────────────────────────────────────

const CIMD_REFRESH_MS = 24 * 60 * 60_000;

/** A client by id: a registered one, or — when the id is an https URL — the metadata document it points at. */
export async function resolveClient(clientId: string, store: OAuthStore, now: number, fetchText = safeFetchText): Promise<OAuthClient | null> {
  if (typeof clientId !== "string" || !clientId || clientId.length > 500) return null;
  const known = await store.getClient(clientId);
  if (!/^https:\/\//.test(clientId)) return known;
  if (known && now - known.createdAt < CIMD_REFRESH_MS) return known;
  try {
    const r = await fetchText(clientId, { timeoutMs: 5_000, maxBytes: 64_000, maxRedirects: 0 });
    if (r.status !== 200) return known;
    const doc = JSON.parse(r.text) as Record<string, unknown>;
    if (doc.client_id !== clientId) return null;
    const uris = doc.redirect_uris;
    if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every((u) => typeof u === "string" && acceptableRedirectUri(u))) return null;
    const client: OAuthClient = { clientId, name: cleanName(doc.client_name), redirectUris: uris as string[], kind: "cimd", createdAt: now };
    await store.saveClient(client);
    return client;
  } catch {
    return known;
  }
}

// ── Authorization request ─────────────────────────────────────────────────────────────

export type AuthorizeParams = Record<string, string | undefined>;

export type AuthorizeCheck =
  | { ok: true; client: OAuthClient; redirectUri: string; challenge: string; state?: string; scope: string; issuer: string }
  /** The client or its redirect URI can't be trusted: show an error, never redirect. */
  | { ok: false; show: string }
  /** The client is genuine but the request is wrong: send the error back to it. */
  | { ok: false; redirect: string };

export function redirectWith(redirectUri: string, params: Record<string, string | undefined>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}

export async function checkAuthorize(p: AuthorizeParams, store: OAuthStore, now: number, fetchText = safeFetchText, issuer = ISSUER): Promise<AuthorizeCheck> {
  const client = p.client_id ? await resolveClient(p.client_id, store, now, fetchText) : null;
  if (!client) return { ok: false, show: "This app isn't registered with Populr. Try connecting from your editor again." };
  const redirectUri = p.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
  if (!redirectUri || !redirectMatches(client.redirectUris, redirectUri)) return { ok: false, show: "This app asked to return to an address it didn't register, so Populr won't send it there." };

  const back = (error: string, description: string) => ({ ok: false as const, redirect: redirectWith(redirectUri, { error, error_description: description, state: p.state, iss: issuer }) });
  if (p.response_type !== "code") return back("unsupported_response_type", "Only response_type=code is supported.");
  if (!validChallenge(p.code_challenge) || p.code_challenge_method !== "S256") return back("invalid_request", "PKCE with code_challenge_method=S256 is required.");
  if (!resourceOk(p.resource, issuer)) return back("invalid_target", "This authorization server only issues tokens for Populr's MCP server.");
  const scope = (p.scope ?? SCOPE).split(/\s+/).filter(Boolean);
  if (scope.some((s) => s !== SCOPE)) return back("invalid_scope", `The only scope is "${SCOPE}".`);
  return { ok: true, client, redirectUri, challenge: p.code_challenge!, state: p.state, scope: SCOPE, issuer };
}

/** The user said yes: a one-time code for the client, as the redirect to send them back with. */
export async function approve(check: Extract<AuthorizeCheck, { ok: true }>, workspace: string, store: OAuthStore, now: number): Promise<string> {
  const code = newSecret("pac_");
  await store.saveCode({
    codeHash: hashToken(code), clientId: check.client.clientId, redirectUri: check.redirectUri, challenge: check.challenge,
    workspace, scope: check.scope, family: randomBytes(12).toString("base64url"), expiresAt: now + CODE_TTL_MS,
  });
  return redirectWith(check.redirectUri, { code, state: check.state, iss: check.issuer });
}

export function deny(check: Extract<AuthorizeCheck, { ok: true }>): string {
  return redirectWith(check.redirectUri, { error: "access_denied", error_description: "The user didn't allow access.", state: check.state, iss: check.issuer });
}

// ── Token endpoint ────────────────────────────────────────────────────────────────────

async function issue(store: OAuthStore, base: { clientId: string; workspace: string; scope: string; family: string; grantedAt: number }, now: number): Promise<Result> {
  const access = newSecret(ACCESS_PREFIX), refresh = newSecret(REFRESH_PREFIX);
  await store.saveToken({ tokenHash: hashToken(access), kind: "access", ...base, expiresAt: now + ACCESS_TTL_MS, revokedAt: null, lastUsedAt: null });
  await store.saveToken({ tokenHash: hashToken(refresh), kind: "refresh", ...base, expiresAt: now + REFRESH_TTL_MS, revokedAt: null, lastUsedAt: null });
  return { status: 200, body: { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_MS / 1000, refresh_token: refresh, scope: base.scope } };
}

export async function token(form: Record<string, string | undefined>, store: OAuthStore, now: number, issuer = ISSUER): Promise<Result> {
  if (!resourceOk(form.resource, issuer)) return oauthError(400, "invalid_target", "Tokens are only issued for Populr's MCP server.");

  if (form.grant_type === "authorization_code") {
    if (!form.code || !form.code_verifier || !form.client_id) return oauthError(400, "invalid_request", "code, code_verifier and client_id are required.");
    const taken = await store.takeCode(hashToken(form.code));
    if (!taken) return oauthError(400, "invalid_grant", "Unknown authorization code.");
    const { code, reused } = taken;
    if (reused) {
      // A spent code presented again: someone has a copy. Revoke what it bought.
      await store.revokeFamily(code.family, now);
      return oauthError(400, "invalid_grant", "This authorization code was already used.");
    }
    if (code.expiresAt <= now) return oauthError(400, "invalid_grant", "The authorization code has expired. Start again from your editor.");
    if (code.clientId !== form.client_id) return oauthError(400, "invalid_grant", "The code was issued to a different client.");
    if (form.redirect_uri !== undefined && form.redirect_uri !== code.redirectUri) return oauthError(400, "invalid_grant", "redirect_uri doesn't match the authorization request.");
    if (!pkceMatches(form.code_verifier, code.challenge)) return oauthError(400, "invalid_grant", "The code_verifier doesn't match.");
    return issue(store, { clientId: code.clientId, workspace: code.workspace, scope: code.scope, family: code.family, grantedAt: now }, now);
  }

  if (form.grant_type === "refresh_token") {
    if (!form.refresh_token) return oauthError(400, "invalid_request", "refresh_token is required.");
    const t = await store.getToken(hashToken(form.refresh_token));
    if (!t || t.kind !== "refresh") return oauthError(400, "invalid_grant", "Unknown refresh token.");
    if (form.client_id && form.client_id !== t.clientId) return oauthError(400, "invalid_grant", "The token was issued to a different client.");
    if (t.revokedAt) {
      // Rotated tokens are revoked; one coming back means a copy is in use. End the sign-in.
      await store.revokeFamily(t.family, now);
      return oauthError(400, "invalid_grant", "This refresh token is no longer valid. Sign in again.");
    }
    if (t.expiresAt <= now) return oauthError(400, "invalid_grant", "The refresh token has expired. Sign in again.");
    await store.revokeToken(t.tokenHash, now);
    return issue(store, { clientId: t.clientId, workspace: t.workspace, scope: t.scope, family: t.family, grantedAt: t.grantedAt }, now);
  }

  return oauthError(400, "unsupported_grant_type", "Use authorization_code or refresh_token.");
}

// ── Using and revoking tokens ─────────────────────────────────────────────────────────

/** The workspace an access token acts for, or null. Records the use. */
export async function workspaceForAccessToken(raw: string, store: OAuthStore, now: number): Promise<string | null> {
  if (!raw.startsWith(ACCESS_PREFIX)) return null;
  const h = hashToken(raw);
  const t = await store.getToken(h);
  if (!t || t.kind !== "access" || t.revokedAt || t.expiresAt <= now) return null;
  await store.touchToken(h, now).catch(() => undefined);
  return t.workspace;
}

/** RFC 7009: always succeeds from the caller's point of view. A refresh token takes its sign-in with it. */
export async function revoke(raw: string | undefined, clientId: string | undefined, store: OAuthStore, now: number): Promise<void> {
  if (!raw) return;
  const t = await store.getToken(hashToken(raw));
  if (!t || (clientId && clientId !== t.clientId)) return;
  if (t.kind === "refresh") await store.revokeFamily(t.family, now);
  else await store.revokeToken(t.tokenHash, now);
}
