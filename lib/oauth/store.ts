import { db, RUNTIME_DDL, type Sql } from "@/lib/db";

// Registered OAuth clients, one-time authorization codes, and tokens (stored as hashes).
//
// A "family" is one sign-in: the code, and every access/refresh token issued from it as the
// refresh token rotates. Reusing a spent code or refresh token revokes the whole family —
// it means a copy leaked somewhere. Revoking an app on the keys page revokes its families.

export type OAuthClient = { clientId: string; name: string; redirectUris: string[]; kind: "dcr" | "cimd"; createdAt: number };

export type AuthCode = {
  codeHash: string; clientId: string; redirectUri: string; challenge: string;
  workspace: string; scope: string; family: string; expiresAt: number;
};

export type TokenRow = {
  tokenHash: string; kind: "access" | "refresh"; clientId: string; workspace: string; scope: string;
  family: string; grantedAt: number; expiresAt: number; revokedAt: number | null; lastUsedAt: number | null;
};

export type Grant = { family: string; clientId: string; clientName: string; grantedAt: number; lastUsedAt: number | null };

export interface OAuthStore {
  saveClient(c: OAuthClient): Promise<void>;
  getClient(clientId: string): Promise<OAuthClient | null>;
  saveCode(c: AuthCode): Promise<void>;
  /** Spends a code. `reused` means it had already been spent. Null if there's no such code. */
  takeCode(codeHash: string): Promise<{ code: AuthCode; reused: boolean } | null>;
  saveToken(t: TokenRow): Promise<void>;
  getToken(tokenHash: string): Promise<TokenRow | null>;
  touchToken(tokenHash: string, at: number): Promise<void>;
  revokeToken(tokenHash: string, at: number): Promise<void>;
  revokeFamily(family: string, at: number, workspace?: string): Promise<number>;
  grants(workspace: string, now: number): Promise<Grant[]>;
}

export class InMemoryOAuthStore implements OAuthStore {
  clients = new Map<string, OAuthClient>();
  codes = new Map<string, AuthCode & { used: boolean }>();
  tokens = new Map<string, TokenRow>();
  async saveClient(c: OAuthClient) { this.clients.set(c.clientId, c); }
  async getClient(id: string) { return this.clients.get(id) ?? null; }
  async saveCode(c: AuthCode) { this.codes.set(c.codeHash, { ...c, used: false }); }
  async takeCode(h: string) {
    const c = this.codes.get(h);
    if (!c) return null;
    const reused = c.used;
    c.used = true;
    const { used: _used, ...code } = c;
    return { code, reused };
  }
  async saveToken(t: TokenRow) { this.tokens.set(t.tokenHash, { ...t }); }
  async getToken(h: string) { const t = this.tokens.get(h); return t ? { ...t } : null; }
  async touchToken(h: string, at: number) { const t = this.tokens.get(h); if (t) t.lastUsedAt = at; }
  async revokeToken(h: string, at: number) { const t = this.tokens.get(h); if (t && !t.revokedAt) t.revokedAt = at; }
  async revokeFamily(family: string, at: number, workspace?: string) {
    let n = 0;
    for (const t of this.tokens.values()) if (t.family === family && (!workspace || t.workspace === workspace) && !t.revokedAt) { t.revokedAt = at; n++; }
    return n;
  }
  async grants(workspace: string, now: number) {
    const fam = new Map<string, Grant>();
    for (const t of this.tokens.values()) {
      if (t.workspace !== workspace || t.revokedAt || t.expiresAt <= now) continue;
      const g = fam.get(t.family) ?? { family: t.family, clientId: t.clientId, clientName: this.clients.get(t.clientId)?.name ?? t.clientId, grantedAt: t.grantedAt, lastUsedAt: null };
      g.lastUsedAt = Math.max(g.lastUsedAt ?? 0, t.lastUsedAt ?? 0) || null;
      fam.set(t.family, g);
    }
    return [...fam.values()].sort((a, b) => b.grantedAt - a.grantedAt);
  }
}

let ready = false;
async function ensure(sql: Sql) {
  if (ready || !RUNTIME_DDL) { ready = true; return; }
  await sql`CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id TEXT PRIMARY KEY,
    client_name TEXT NOT NULL,
    redirect_uris JSONB NOT NULL,
    kind TEXT NOT NULL,
    created_at BIGINT NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS oauth_codes (
    code_hash TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    challenge TEXT NOT NULL,
    workspace TEXT NOT NULL,
    scope TEXT NOT NULL,
    family TEXT NOT NULL,
    expires_at BIGINT NOT NULL,
    used BOOLEAN NOT NULL DEFAULT false
  )`;
  await sql`CREATE TABLE IF NOT EXISTS oauth_tokens (
    token_hash TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    client_id TEXT NOT NULL,
    workspace TEXT NOT NULL,
    scope TEXT NOT NULL,
    family TEXT NOT NULL,
    granted_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    revoked_at BIGINT,
    last_used_at BIGINT
  )`;
  await sql`CREATE INDEX IF NOT EXISTS oauth_tokens_family ON oauth_tokens (family)`;
  await sql`CREATE INDEX IF NOT EXISTS oauth_tokens_workspace ON oauth_tokens (workspace)`;
  ready = true;
}

type ClientRow = { client_id: string; client_name: string; redirect_uris: string[]; kind: string; created_at: string | number };
type CodeRow = { code_hash: string; client_id: string; redirect_uri: string; challenge: string; workspace: string; scope: string; family: string; expires_at: string | number; used: boolean };
type TokRow = { token_hash: string; kind: string; client_id: string; workspace: string; scope: string; family: string; granted_at: string | number; expires_at: string | number; revoked_at: string | number | null; last_used_at: string | number | null };

const num = (v: string | number | null) => (v === null ? null : Number(v));
const toCode = (r: CodeRow): AuthCode => ({ codeHash: r.code_hash, clientId: r.client_id, redirectUri: r.redirect_uri, challenge: r.challenge, workspace: r.workspace, scope: r.scope, family: r.family, expiresAt: Number(r.expires_at) });
const toToken = (r: TokRow): TokenRow => ({ tokenHash: r.token_hash, kind: r.kind as TokenRow["kind"], clientId: r.client_id, workspace: r.workspace, scope: r.scope, family: r.family, grantedAt: Number(r.granted_at), expiresAt: Number(r.expires_at), revokedAt: num(r.revoked_at), lastUsedAt: num(r.last_used_at) });

export class NeonOAuthStore implements OAuthStore {
  constructor(private sql: Sql) {}
  async saveClient(c: OAuthClient) {
    await ensure(this.sql);
    await this.sql`INSERT INTO oauth_clients (client_id, client_name, redirect_uris, kind, created_at)
      VALUES (${c.clientId}, ${c.name}, ${JSON.stringify(c.redirectUris)}::jsonb, ${c.kind}, ${c.createdAt})
      ON CONFLICT (client_id) DO UPDATE SET client_name = EXCLUDED.client_name, redirect_uris = EXCLUDED.redirect_uris, created_at = EXCLUDED.created_at`;
  }
  async getClient(id: string) {
    await ensure(this.sql);
    const rows = (await this.sql`SELECT * FROM oauth_clients WHERE client_id = ${id}`) as ClientRow[];
    const r = rows[0];
    return r ? { clientId: r.client_id, name: r.client_name, redirectUris: r.redirect_uris, kind: r.kind as OAuthClient["kind"], createdAt: Number(r.created_at) } : null;
  }
  async saveCode(c: AuthCode) {
    await ensure(this.sql);
    await this.sql`INSERT INTO oauth_codes (code_hash, client_id, redirect_uri, challenge, workspace, scope, family, expires_at)
      VALUES (${c.codeHash}, ${c.clientId}, ${c.redirectUri}, ${c.challenge}, ${c.workspace}, ${c.scope}, ${c.family}, ${c.expiresAt})`;
  }
  async takeCode(h: string) {
    await ensure(this.sql);
    // Spend it atomically: only one request can flip used from false to true.
    const spent = (await this.sql`UPDATE oauth_codes SET used = true WHERE code_hash = ${h} AND used = false RETURNING *`) as CodeRow[];
    if (spent[0]) return { code: toCode(spent[0]), reused: false };
    const prior = (await this.sql`SELECT * FROM oauth_codes WHERE code_hash = ${h}`) as CodeRow[];
    return prior[0] ? { code: toCode(prior[0]), reused: true } : null;
  }
  async saveToken(t: TokenRow) {
    await ensure(this.sql);
    await this.sql`INSERT INTO oauth_tokens (token_hash, kind, client_id, workspace, scope, family, granted_at, expires_at)
      VALUES (${t.tokenHash}, ${t.kind}, ${t.clientId}, ${t.workspace}, ${t.scope}, ${t.family}, ${t.grantedAt}, ${t.expiresAt})`;
  }
  async getToken(h: string) {
    await ensure(this.sql);
    const rows = (await this.sql`SELECT * FROM oauth_tokens WHERE token_hash = ${h}`) as TokRow[];
    return rows[0] ? toToken(rows[0]) : null;
  }
  async touchToken(h: string, at: number) {
    await ensure(this.sql);
    await this.sql`UPDATE oauth_tokens SET last_used_at = ${at} WHERE token_hash = ${h}`;
  }
  async revokeToken(h: string, at: number) {
    await ensure(this.sql);
    await this.sql`UPDATE oauth_tokens SET revoked_at = ${at} WHERE token_hash = ${h} AND revoked_at IS NULL`;
  }
  async revokeFamily(family: string, at: number, workspace?: string) {
    await ensure(this.sql);
    const rows = (workspace
      ? await this.sql`UPDATE oauth_tokens SET revoked_at = ${at} WHERE family = ${family} AND workspace = ${workspace} AND revoked_at IS NULL RETURNING token_hash`
      : await this.sql`UPDATE oauth_tokens SET revoked_at = ${at} WHERE family = ${family} AND revoked_at IS NULL RETURNING token_hash`) as unknown[];
    return rows.length;
  }
  async grants(workspace: string, now: number) {
    await ensure(this.sql);
    const rows = (await this.sql`
      SELECT t.family, t.client_id, COALESCE(c.client_name, t.client_id) AS client_name,
             min(t.granted_at) AS granted_at, max(t.last_used_at) AS last_used_at
      FROM oauth_tokens t LEFT JOIN oauth_clients c ON c.client_id = t.client_id
      WHERE t.workspace = ${workspace} AND t.revoked_at IS NULL AND t.expires_at > ${now}
      GROUP BY t.family, t.client_id, c.client_name
      ORDER BY granted_at DESC`) as { family: string; client_id: string; client_name: string; granted_at: string | number; last_used_at: string | number | null }[];
    return rows.map((r) => ({ family: r.family, clientId: r.client_id, clientName: r.client_name, grantedAt: Number(r.granted_at), lastUsedAt: num(r.last_used_at) }));
  }
}

// On globalThis so the dev server's separate route bundles share one in-memory store.
const g = globalThis as unknown as { __populrOAuthStore?: OAuthStore };
export function oauthStore(): OAuthStore {
  if (!g.__populrOAuthStore) { const sql = db(); g.__populrOAuthStore = sql ? new NeonOAuthStore(sql) : new InMemoryOAuthStore(); }
  return g.__populrOAuthStore;
}
