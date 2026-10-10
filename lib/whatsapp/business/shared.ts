import { db } from "@/lib/db";
import { loadCanonicalProfile } from "@/lib/services/cmo-context";
import { cloudConfig, type CloudConfig } from "../cloud";
import type { Knowledge } from "./agent";
import type { FlowDeps } from "./flow";
import { InMemoryBusinessStore, NeonBusinessStore, type BusinessConnection, type BusinessStore } from "./store";

let store: BusinessStore | null = null;
export function businessStore(): BusinessStore {
  if (!store) {
    const sql = db();
    store = sql ? new NeonBusinessStore(sql) : new InMemoryBusinessStore();
  }
  return store;
}

/** The business's own sending credentials, unsealed only at the moment of sending. */
export async function businessConfig(conn: BusinessConnection): Promise<CloudConfig | null> {
  const s = await businessStore().secrets(conn.id).catch(() => null);
  return s ? { token: s.token, phoneNumberId: conn.phoneNumberId } : null;
}

export async function knowledgeFor(conn: BusinessConnection): Promise<Knowledge> {
  const sql = db();
  const [profile, learned] = await Promise.all([
    sql ? loadCanonicalProfile(sql, conn.workspace).catch(() => null) : null,
    businessStore().learned(conn.workspace).catch(() => []),
  ]);
  return {
    businessName: profile?.name || "our",
    about: profile?.oneLiner,
    faq: conn.knowledge,
    learned,
  };
}

export async function flowDeps(): Promise<FlowDeps> {
  const { whatsappStore } = await import("../shared");
  return {
    business: businessStore(),
    founderLinks: whatsappStore(),
    populrCloud: cloudConfig(),
    knowledgeFor,
    now: Date.now,
  };
}

/**
 * Checks credentials against Meta before anything is stored, and reads the number from Meta
 * rather than trusting what was typed. A wrong token found now is a form error; found later
 * it is a customer who never got an answer.
 */
export async function verifyBusinessNumber(phoneNumberId: string, token: string): Promise<{ ok: true; displayNumber: string; name: string | null } | { ok: false; error: string }> {
  try {
    const v = process.env.WHATSAPP_GRAPH_VERSION || "v23.0";
    const res = await fetch(`https://graph.facebook.com/${v}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000),
    });
    const j = await res.json().catch(() => ({})) as { display_phone_number?: string; verified_name?: string; error?: { message?: string } };
    if (!res.ok || !j.display_phone_number) return { ok: false, error: j.error?.message?.slice(0, 200) || `Meta returned ${res.status}` };
    return { ok: true, displayNumber: j.display_phone_number.replace(/\D/g, ""), name: j.verified_name ?? null };
  } catch {
    return { ok: false, error: "Couldn't reach Meta to check these details." };
  }
}
