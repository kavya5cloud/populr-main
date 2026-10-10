import { randomInt } from "node:crypto";
import { RUNTIME_DDL, type Sql } from "@/lib/db";

// Which WhatsApp number belongs to which workspace.
//
// A number is linked by the founder sending "link 482913" from it, where the code was shown
// to them inside Populr. Starting from their side does two jobs: it proves they hold the
// number (no SMS to verify), and it opens WhatsApp's 24-hour window, so the reply can be a
// normal message rather than a pre-approved template.
//
// One number, one workspace. A number can only ever act on the workspace it is linked to;
// that mapping is the entire tenant boundary for this channel.

const CODE_TTL_MS = 15 * 60_000;

export type WaLink = { waId: string; workspace: string; linkedAt: number };

export interface WhatsAppStore {
  createCode(workspace: string, now: number): Promise<string>;
  /** Consumes the code: valid once, within its TTL. */
  redeemCode(code: string, now: number): Promise<string | null>;
  link(waId: string, workspace: string, now: number): Promise<void>;
  unlink(waId: string): Promise<void>;
  byNumber(waId: string): Promise<WaLink | null>;
  byWorkspace(workspace: string): Promise<WaLink | null>;
  /** True the first time an inbound message id is seen. Meta redelivers on any doubt. */
  firstSeen(messageId: string, now: number): Promise<boolean>;
  /** Every linked number, for the morning digest. */
  allLinks(): Promise<WaLink[]>;
  lastDigest(workspace: string): Promise<number | null>;
  markDigest(workspace: string, at: number): Promise<void>;
}

const newCode = () => String(randomInt(100_000, 1_000_000));

export class InMemoryWhatsAppStore implements WhatsAppStore {
  private codes = new Map<string, { workspace: string; until: number }>();
  private links = new Map<string, WaLink>();
  private seen = new Map<string, number>();
  private digests = new Map<string, number>();

  async createCode(workspace: string, now: number) {
    for (const [c, v] of this.codes) if (v.workspace === workspace) this.codes.delete(c);
    let code = newCode();
    while (this.codes.has(code)) code = newCode();
    this.codes.set(code, { workspace, until: now + CODE_TTL_MS });
    return code;
  }
  async redeemCode(code: string, now: number) {
    const v = this.codes.get(code);
    this.codes.delete(code);
    return v && v.until > now ? v.workspace : null;
  }
  async link(waId: string, workspace: string, now: number) {
    for (const [n, l] of this.links) if (l.workspace === workspace) this.links.delete(n);
    this.links.set(waId, { waId, workspace, linkedAt: now });
  }
  async unlink(waId: string) { this.links.delete(waId); }
  async byNumber(waId: string) { return this.links.get(waId) ?? null; }
  async byWorkspace(workspace: string) { return [...this.links.values()].find((l) => l.workspace === workspace) ?? null; }
  async firstSeen(id: string, now: number) {
    for (const [k, t] of this.seen) if (t < now - 86_400_000) this.seen.delete(k);
    if (this.seen.has(id)) return false;
    this.seen.set(id, now);
    return true;
  }
  async allLinks() { return [...this.links.values()]; }
  async lastDigest(ws: string) { return this.digests.get(ws) ?? null; }
  async markDigest(ws: string, at: number) { this.digests.set(ws, at); }
}

let ready = false;
async function ensure(sql: Sql) {
  if (ready || !RUNTIME_DDL) { ready = true; return; }
  await sql`CREATE TABLE IF NOT EXISTS whatsapp_link_codes (code TEXT PRIMARY KEY, workspace TEXT NOT NULL, expires_at BIGINT NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS whatsapp_links (wa_id TEXT PRIMARY KEY, workspace TEXT NOT NULL UNIQUE, linked_at BIGINT NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS whatsapp_seen (message_id TEXT PRIMARY KEY, seen_at BIGINT NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS whatsapp_digest_log (workspace TEXT PRIMARY KEY, sent_at BIGINT NOT NULL)`;
  ready = true;
}

export class NeonWhatsAppStore implements WhatsAppStore {
  constructor(private sql: Sql) {}

  async createCode(workspace: string, now: number) {
    await ensure(this.sql);
    await this.sql`DELETE FROM whatsapp_link_codes WHERE workspace = ${workspace} OR expires_at < ${now}`;
    for (let i = 0; i < 5; i++) {
      const code = newCode();
      const rows = await this.sql`INSERT INTO whatsapp_link_codes (code, workspace, expires_at)
        VALUES (${code}, ${workspace}, ${now + CODE_TTL_MS}) ON CONFLICT (code) DO NOTHING RETURNING code` as { code: string }[];
      if (rows.length) return code;
    }
    throw new Error("could not allocate a link code");
  }

  async redeemCode(code: string, now: number) {
    await ensure(this.sql);
    // DELETE … RETURNING is the consume: two redemptions racing can't both get a row.
    const rows = await this.sql`DELETE FROM whatsapp_link_codes WHERE code = ${code} RETURNING workspace, expires_at` as { workspace: string; expires_at: string | number }[];
    return rows[0] && Number(rows[0].expires_at) > now ? rows[0].workspace : null;
  }

  async link(waId: string, workspace: string, now: number) {
    await ensure(this.sql);
    await this.sql`DELETE FROM whatsapp_links WHERE workspace = ${workspace} OR wa_id = ${waId}`;
    await this.sql`INSERT INTO whatsapp_links (wa_id, workspace, linked_at) VALUES (${waId}, ${workspace}, ${now})`;
  }

  async unlink(waId: string) {
    await ensure(this.sql);
    await this.sql`DELETE FROM whatsapp_links WHERE wa_id = ${waId}`;
  }

  async byNumber(waId: string) {
    await ensure(this.sql);
    const r = await this.sql`SELECT wa_id, workspace, linked_at FROM whatsapp_links WHERE wa_id = ${waId}` as { wa_id: string; workspace: string; linked_at: string | number }[];
    return r[0] ? { waId: r[0].wa_id, workspace: r[0].workspace, linkedAt: Number(r[0].linked_at) } : null;
  }

  async byWorkspace(workspace: string) {
    await ensure(this.sql);
    const r = await this.sql`SELECT wa_id, workspace, linked_at FROM whatsapp_links WHERE workspace = ${workspace}` as { wa_id: string; workspace: string; linked_at: string | number }[];
    return r[0] ? { waId: r[0].wa_id, workspace: r[0].workspace, linkedAt: Number(r[0].linked_at) } : null;
  }

  async firstSeen(id: string, now: number) {
    await ensure(this.sql);
    const rows = await this.sql`INSERT INTO whatsapp_seen (message_id, seen_at) VALUES (${id}, ${now})
      ON CONFLICT (message_id) DO NOTHING RETURNING message_id` as unknown[];
    // Ids older than a day can't be redelivered any more; keep the table from growing forever.
    if (Math.random() < 0.02) await this.sql`DELETE FROM whatsapp_seen WHERE seen_at < ${now - 86_400_000}`;
    return rows.length > 0;
  }

  async allLinks() {
    await ensure(this.sql);
    const r = await this.sql`SELECT wa_id, workspace, linked_at FROM whatsapp_links` as { wa_id: string; workspace: string; linked_at: string | number }[];
    return r.map((x) => ({ waId: x.wa_id, workspace: x.workspace, linkedAt: Number(x.linked_at) }));
  }

  async lastDigest(workspace: string) {
    await ensure(this.sql);
    const r = await this.sql`SELECT sent_at FROM whatsapp_digest_log WHERE workspace = ${workspace}` as { sent_at: string | number }[];
    return r[0] ? Number(r[0].sent_at) : null;
  }

  async markDigest(workspace: string, at: number) {
    await ensure(this.sql);
    await this.sql`INSERT INTO whatsapp_digest_log (workspace, sent_at) VALUES (${workspace}, ${at})
      ON CONFLICT (workspace) DO UPDATE SET sent_at = EXCLUDED.sent_at`;
  }
}

/** A number shown back to its owner: country code and last four, nothing in between. */
export function maskNumber(waId: string): string {
  return waId.length > 6 ? `+${waId.slice(0, 2)} ••••• ${waId.slice(-4)}` : "a WhatsApp number";
}
