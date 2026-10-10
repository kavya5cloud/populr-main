import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db, RUNTIME_DDL, type Sql } from "@/lib/db";

// Access keys for Populr's MCP server and editor extension.
//
// A key belongs to exactly one workspace and opens only that workspace's data — the tenant
// boundary for everything a coding assistant can reach. Only a SHA-256 of the key is stored:
// it's shown once when created and never again, so a database leak doesn't hand out working
// keys. Keys are revocable, and each records when it was last used, so a founder can see
// which ones are live before deleting one.
//
// Format: pop_ + 32 random bytes (base64url). The prefix lets secret scanners — GitHub's
// included — recognise a leaked key, and lets the first characters be shown for identification.

export const KEY_PREFIX = "pop_";
const MAX_KEYS_PER_WORKSPACE = 10;

export type ApiKey = { id: string; workspace: string; name: string; hint: string; createdAt: number; lastUsedAt: number | null };

export const hashKey = (key: string) => createHash("sha256").update(key, "utf8").digest("hex");

export function newKey(): { key: string; hash: string; hint: string } {
  const key = KEY_PREFIX + randomBytes(32).toString("base64url");
  return { key, hash: hashKey(key), hint: `${key.slice(0, 8)}…${key.slice(-4)}` };
}

export function looksLikeKey(s: string): boolean {
  return /^pop_[A-Za-z0-9_-]{40,60}$/.test(s);
}

export interface KeyStore {
  create(workspace: string, name: string, now: number): Promise<{ key: string; record: ApiKey } | null>;
  list(workspace: string): Promise<ApiKey[]>;
  revoke(workspace: string, id: string): Promise<boolean>;
  /** The workspace a presented key belongs to, or null. Records the use. */
  resolve(key: string, now: number): Promise<string | null>;
}

const keyId = () => `key_${randomBytes(8).toString("base64url")}`;

export class InMemoryKeyStore implements KeyStore {
  private rows = new Map<string, ApiKey & { hash: string }>();
  async create(workspace: string, name: string, now: number) {
    if ((await this.list(workspace)).length >= MAX_KEYS_PER_WORKSPACE) return null;
    const k = newKey();
    const record: ApiKey = { id: keyId(), workspace, name, hint: k.hint, createdAt: now, lastUsedAt: null };
    this.rows.set(record.id, { ...record, hash: k.hash });
    return { key: k.key, record };
  }
  async list(workspace: string) {
    return [...this.rows.values()].filter((r) => r.workspace === workspace).map(({ hash: _h, ...r }) => r);
  }
  async revoke(workspace: string, id: string) {
    const r = this.rows.get(id);
    if (!r || r.workspace !== workspace) return false;
    return this.rows.delete(id);
  }
  async resolve(key: string, now: number) {
    if (!looksLikeKey(key)) return null;
    const h = Buffer.from(hashKey(key), "hex");
    for (const r of this.rows.values()) {
      if (timingSafeEqual(h, Buffer.from(r.hash, "hex"))) { r.lastUsedAt = now; return r.workspace; }
    }
    return null;
  }
}

let ready = false;
async function ensure(sql: Sql) {
  if (ready || !RUNTIME_DDL) { ready = true; return; }
  await sql`CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY, workspace TEXT NOT NULL, name TEXT NOT NULL, hint TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE, created_at BIGINT NOT NULL, last_used_at BIGINT)`;
  await sql`CREATE INDEX IF NOT EXISTS api_keys_workspace ON api_keys (workspace)`;
  ready = true;
}

type Row = { id: string; workspace: string; name: string; hint: string; created_at: string | number; last_used_at: string | number | null };
const toKey = (r: Row): ApiKey => ({ id: r.id, workspace: r.workspace, name: r.name, hint: r.hint, createdAt: Number(r.created_at), lastUsedAt: r.last_used_at === null ? null : Number(r.last_used_at) });

export class NeonKeyStore implements KeyStore {
  constructor(private sql: Sql) {}
  async create(workspace: string, name: string, now: number) {
    await ensure(this.sql);
    if ((await this.list(workspace)).length >= MAX_KEYS_PER_WORKSPACE) return null;
    const k = newKey();
    const id = keyId();
    await this.sql`INSERT INTO api_keys (id, workspace, name, hint, key_hash, created_at) VALUES (${id}, ${workspace}, ${name}, ${k.hint}, ${k.hash}, ${now})`;
    return { key: k.key, record: { id, workspace, name, hint: k.hint, createdAt: now, lastUsedAt: null } };
  }
  async list(workspace: string) {
    await ensure(this.sql);
    return (await this.sql`SELECT id, workspace, name, hint, created_at, last_used_at FROM api_keys WHERE workspace = ${workspace} ORDER BY created_at DESC` as Row[]).map(toKey);
  }
  async revoke(workspace: string, id: string) {
    await ensure(this.sql);
    const r = await this.sql`DELETE FROM api_keys WHERE id = ${id} AND workspace = ${workspace} RETURNING id` as unknown[];
    return r.length > 0;
  }
  async resolve(key: string, now: number) {
    if (!looksLikeKey(key)) return null;
    await ensure(this.sql);
    // Looked up by hash: the index makes it one row, and the database never sees the key.
    const r = await this.sql`UPDATE api_keys SET last_used_at = ${now} WHERE key_hash = ${hashKey(key)} RETURNING workspace` as { workspace: string }[];
    return r[0]?.workspace ?? null;
  }
}

let store: KeyStore | null = null;
export function keyStore(): KeyStore {
  if (!store) { const sql = db(); store = sql ? new NeonKeyStore(sql) : new InMemoryKeyStore(); }
  return store;
}
