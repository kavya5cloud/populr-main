import { randomBytes, randomInt } from "node:crypto";
import { RUNTIME_DDL, type Sql } from "@/lib/db";
import { open, seal, type Sealed } from "@/lib/social/crypto";

// A business's own WhatsApp number, connected so Populr can answer its customers.
//
// Each business brings its own WhatsApp Business account. Its access token and app secret
// are sealed (AES-256-GCM, the same as social tokens) and never returned to the browser.
// Each connection gets its own webhook URL and verify token, so a delivery identifies the
// connection by path and is verified with that connection's own app secret — one business
// can never post into another's conversations.
//
// Also kept here: questions waiting on the founder, and the answers the founder has given,
// which become knowledge for the next customer who asks.

export type BusinessConnection = {
  id: string;
  workspace: string;
  phoneNumberId: string;
  /** Shown back masked; the number customers message. */
  displayNumber: string;
  verifyToken: string;
  enabled: boolean;
  /** What the founder wrote for the agent to answer from: hours, prices, delivery, policy. */
  knowledge: string;
  createdAt: number;
};

export type Secrets = { token: string; appSecret: string };

export type Escalation = {
  id: string;
  /** Short number the founder types: "reply 12 …". Unique among this workspace's open questions. */
  ref: number;
  connectionId: string;
  workspace: string;
  customer: string;
  question: string;
  askedAt: number;
  answeredAt: number | null;
};

export type Learned = { question: string; answer: string; at: number };

export interface BusinessStore {
  connect(input: { workspace: string; phoneNumberId: string; displayNumber: string; secrets: Secrets; now: number }): Promise<BusinessConnection>;
  get(id: string): Promise<BusinessConnection | null>;
  byWorkspace(workspace: string): Promise<BusinessConnection | null>;
  secrets(id: string): Promise<Secrets | null>;
  update(id: string, patch: Partial<Pick<BusinessConnection, "enabled" | "knowledge">>): Promise<void>;
  disconnect(id: string): Promise<void>;

  escalate(e: Omit<Escalation, "id" | "ref" | "answeredAt">): Promise<Escalation>;
  openEscalation(workspace: string, ref: number): Promise<Escalation | null>;
  openEscalations(workspace: string): Promise<Escalation[]>;
  resolve(id: string, at: number): Promise<void>;

  learn(workspace: string, l: Learned): Promise<void>;
  learned(workspace: string): Promise<Learned[]>;

  firstSeen(messageId: string, now: number): Promise<boolean>;
  /** Messages from this customer in the last hour — the per-customer spend limit. */
  hit(connectionId: string, customer: string, now: number): Promise<number>;
}

const id = (p: string) => `${p}_${randomBytes(9).toString("base64url")}`;
const LEARNED_CAP = 200;

export class InMemoryBusinessStore implements BusinessStore {
  private conns = new Map<string, BusinessConnection & { sealed: { token: Sealed; appSecret: Sealed } }>();
  private escs = new Map<string, Escalation>();
  private know = new Map<string, Learned[]>();
  private seen = new Set<string>();
  private hits = new Map<string, number[]>();

  async connect(i: { workspace: string; phoneNumberId: string; displayNumber: string; secrets: Secrets; now: number }) {
    for (const [k, c] of this.conns) if (c.workspace === i.workspace) this.conns.delete(k);
    const c = {
      id: id("wab"), workspace: i.workspace, phoneNumberId: i.phoneNumberId, displayNumber: i.displayNumber,
      verifyToken: randomBytes(18).toString("base64url"), enabled: false, knowledge: "", createdAt: i.now,
      sealed: { token: seal(i.secrets.token), appSecret: seal(i.secrets.appSecret) },
    };
    this.conns.set(c.id, c);
    return strip(c);
  }
  async get(cid: string) { const c = this.conns.get(cid); return c ? strip(c) : null; }
  async byWorkspace(ws: string) { const c = [...this.conns.values()].find((x) => x.workspace === ws); return c ? strip(c) : null; }
  async secrets(cid: string) { const c = this.conns.get(cid); return c ? { token: open(c.sealed.token), appSecret: open(c.sealed.appSecret) } : null; }
  async update(cid: string, patch: Partial<Pick<BusinessConnection, "enabled" | "knowledge">>) { const c = this.conns.get(cid); if (c) Object.assign(c, patch); }
  async disconnect(cid: string) { this.conns.delete(cid); }

  async escalate(e: Omit<Escalation, "id" | "ref" | "answeredAt">) {
    const open = [...this.escs.values()].filter((x) => x.workspace === e.workspace && !x.answeredAt).map((x) => x.ref);
    let ref = randomInt(10, 100);
    while (open.includes(ref)) ref = randomInt(10, 100);
    const full: Escalation = { ...e, id: id("esc"), ref, answeredAt: null };
    this.escs.set(full.id, full);
    return full;
  }
  async openEscalation(ws: string, ref: number) { return [...this.escs.values()].find((x) => x.workspace === ws && x.ref === ref && !x.answeredAt) ?? null; }
  async openEscalations(ws: string) { return [...this.escs.values()].filter((x) => x.workspace === ws && !x.answeredAt).sort((a, b) => a.askedAt - b.askedAt); }
  async resolve(eid: string, at: number) { const e = this.escs.get(eid); if (e) e.answeredAt = at; }

  async learn(ws: string, l: Learned) { this.know.set(ws, [...(this.know.get(ws) ?? []), l].slice(-LEARNED_CAP)); }
  async learned(ws: string) { return this.know.get(ws) ?? []; }

  async firstSeen(mid: string) { if (this.seen.has(mid)) return false; this.seen.add(mid); return true; }
  async hit(cid: string, customer: string, now: number) {
    const k = `${cid}:${customer}`;
    const recent = [...(this.hits.get(k) ?? []).filter((t) => t > now - 3_600_000), now];
    this.hits.set(k, recent);
    return recent.length;
  }
}

function strip<T extends BusinessConnection>(c: T): BusinessConnection {
  const { id, workspace, phoneNumberId, displayNumber, verifyToken, enabled, knowledge, createdAt } = c;
  return { id, workspace, phoneNumberId, displayNumber, verifyToken, enabled, knowledge, createdAt };
}

let ready = false;
async function ensure(sql: Sql) {
  if (ready || !RUNTIME_DDL) { ready = true; return; }
  await sql`CREATE TABLE IF NOT EXISTS whatsapp_business (
    id TEXT PRIMARY KEY, workspace TEXT NOT NULL UNIQUE, phone_number_id TEXT NOT NULL, display_number TEXT NOT NULL,
    verify_token TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT false, knowledge TEXT NOT NULL DEFAULT '',
    sealed JSONB NOT NULL, created_at BIGINT NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS whatsapp_escalations (
    id TEXT PRIMARY KEY, ref INT NOT NULL, connection_id TEXT NOT NULL, workspace TEXT NOT NULL,
    customer TEXT NOT NULL, question TEXT NOT NULL, asked_at BIGINT NOT NULL, answered_at BIGINT)`;
  await sql`CREATE TABLE IF NOT EXISTS whatsapp_learned (workspace TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, at BIGINT NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS whatsapp_business_seen (message_id TEXT PRIMARY KEY, seen_at BIGINT NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS whatsapp_customer_hits (connection_id TEXT NOT NULL, customer TEXT NOT NULL, at BIGINT NOT NULL)`;
  ready = true;
}

type ConnRow = { id: string; workspace: string; phone_number_id: string; display_number: string; verify_token: string; enabled: boolean; knowledge: string; created_at: string | number };
const toConn = (r: ConnRow): BusinessConnection => ({
  id: r.id, workspace: r.workspace, phoneNumberId: r.phone_number_id, displayNumber: r.display_number,
  verifyToken: r.verify_token, enabled: r.enabled, knowledge: r.knowledge, createdAt: Number(r.created_at),
});
type EscRow = { id: string; ref: number; connection_id: string; workspace: string; customer: string; question: string; asked_at: string | number; answered_at: string | number | null };
const toEsc = (r: EscRow): Escalation => ({
  id: r.id, ref: Number(r.ref), connectionId: r.connection_id, workspace: r.workspace, customer: r.customer,
  question: r.question, askedAt: Number(r.asked_at), answeredAt: r.answered_at === null ? null : Number(r.answered_at),
});

export class NeonBusinessStore implements BusinessStore {
  constructor(private sql: Sql) {}

  async connect(i: { workspace: string; phoneNumberId: string; displayNumber: string; secrets: Secrets; now: number }) {
    await ensure(this.sql);
    const c = { id: id("wab"), verifyToken: randomBytes(18).toString("base64url") };
    const sealed = JSON.stringify({ token: seal(i.secrets.token), appSecret: seal(i.secrets.appSecret) });
    await this.sql`DELETE FROM whatsapp_business WHERE workspace = ${i.workspace}`;
    await this.sql`INSERT INTO whatsapp_business (id, workspace, phone_number_id, display_number, verify_token, enabled, knowledge, sealed, created_at)
      VALUES (${c.id}, ${i.workspace}, ${i.phoneNumberId}, ${i.displayNumber}, ${c.verifyToken}, false, '', ${sealed}, ${i.now})`;
    return { id: c.id, workspace: i.workspace, phoneNumberId: i.phoneNumberId, displayNumber: i.displayNumber, verifyToken: c.verifyToken, enabled: false, knowledge: "", createdAt: i.now };
  }

  async get(cid: string) {
    await ensure(this.sql);
    const r = await this.sql`SELECT * FROM whatsapp_business WHERE id = ${cid}` as ConnRow[];
    return r[0] ? toConn(r[0]) : null;
  }

  async byWorkspace(ws: string) {
    await ensure(this.sql);
    const r = await this.sql`SELECT * FROM whatsapp_business WHERE workspace = ${ws}` as ConnRow[];
    return r[0] ? toConn(r[0]) : null;
  }

  async secrets(cid: string) {
    await ensure(this.sql);
    const r = await this.sql`SELECT sealed FROM whatsapp_business WHERE id = ${cid}` as { sealed: { token: Sealed; appSecret: Sealed } }[];
    return r[0] ? { token: open(r[0].sealed.token), appSecret: open(r[0].sealed.appSecret) } : null;
  }

  async update(cid: string, patch: Partial<Pick<BusinessConnection, "enabled" | "knowledge">>) {
    await ensure(this.sql);
    if (patch.enabled !== undefined) await this.sql`UPDATE whatsapp_business SET enabled = ${patch.enabled} WHERE id = ${cid}`;
    if (patch.knowledge !== undefined) await this.sql`UPDATE whatsapp_business SET knowledge = ${patch.knowledge} WHERE id = ${cid}`;
  }

  async disconnect(cid: string) {
    await ensure(this.sql);
    await this.sql`DELETE FROM whatsapp_business WHERE id = ${cid}`;
  }

  async escalate(e: Omit<Escalation, "id" | "ref" | "answeredAt">) {
    await ensure(this.sql);
    const open = new Set((await this.sql`SELECT ref FROM whatsapp_escalations WHERE workspace = ${e.workspace} AND answered_at IS NULL` as { ref: number }[]).map((r) => Number(r.ref)));
    let ref = randomInt(10, 100);
    for (let i = 0; i < 200 && open.has(ref); i++) ref = randomInt(10, 1000);
    const full: Escalation = { ...e, id: id("esc"), ref, answeredAt: null };
    await this.sql`INSERT INTO whatsapp_escalations (id, ref, connection_id, workspace, customer, question, asked_at)
      VALUES (${full.id}, ${ref}, ${e.connectionId}, ${e.workspace}, ${e.customer}, ${e.question}, ${e.askedAt})`;
    return full;
  }

  async openEscalation(ws: string, ref: number) {
    await ensure(this.sql);
    const r = await this.sql`SELECT * FROM whatsapp_escalations WHERE workspace = ${ws} AND ref = ${ref} AND answered_at IS NULL LIMIT 1` as EscRow[];
    return r[0] ? toEsc(r[0]) : null;
  }

  async openEscalations(ws: string) {
    await ensure(this.sql);
    return (await this.sql`SELECT * FROM whatsapp_escalations WHERE workspace = ${ws} AND answered_at IS NULL ORDER BY asked_at` as EscRow[]).map(toEsc);
  }

  async resolve(eid: string, at: number) {
    await ensure(this.sql);
    await this.sql`UPDATE whatsapp_escalations SET answered_at = ${at} WHERE id = ${eid}`;
  }

  async learn(ws: string, l: Learned) {
    await ensure(this.sql);
    await this.sql`INSERT INTO whatsapp_learned (workspace, question, answer, at) VALUES (${ws}, ${l.question}, ${l.answer}, ${l.at})`;
  }

  async learned(ws: string) {
    await ensure(this.sql);
    return (await this.sql`SELECT question, answer, at FROM whatsapp_learned WHERE workspace = ${ws} ORDER BY at DESC LIMIT ${LEARNED_CAP}` as { question: string; answer: string; at: string | number }[])
      .map((r) => ({ question: r.question, answer: r.answer, at: Number(r.at) }));
  }

  async firstSeen(mid: string, now: number) {
    await ensure(this.sql);
    const r = await this.sql`INSERT INTO whatsapp_business_seen (message_id, seen_at) VALUES (${mid}, ${now}) ON CONFLICT DO NOTHING RETURNING message_id` as unknown[];
    if (Math.random() < 0.02) await this.sql`DELETE FROM whatsapp_business_seen WHERE seen_at < ${now - 86_400_000}`;
    return r.length > 0;
  }

  async hit(cid: string, customer: string, now: number) {
    await ensure(this.sql);
    await this.sql`INSERT INTO whatsapp_customer_hits (connection_id, customer, at) VALUES (${cid}, ${customer}, ${now})`;
    if (Math.random() < 0.02) await this.sql`DELETE FROM whatsapp_customer_hits WHERE at < ${now - 3_600_000}`;
    const r = await this.sql`SELECT count(*)::int AS n FROM whatsapp_customer_hits WHERE connection_id = ${cid} AND customer = ${customer} AND at > ${now - 3_600_000}` as { n: number }[];
    return r[0]?.n ?? 1;
  }
}
