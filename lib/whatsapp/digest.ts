import type { CloudConfig } from "./cloud";
import type { AssistantDeps } from "./assistant";

// The morning message.
//
// The one time Populr starts the conversation. WhatsApp only allows that with a template
// Meta has approved in advance, so this sends exactly one, and only when it has something
// to say: posts waiting for the founder's OK. A digest that says "nothing today" every
// morning is the fastest way to be muted.
//
// The template to create in WhatsApp Manager (category: Utility, language: English):
//
//   name:  daily_plan        (or set WHATSAPP_DIGEST_TEMPLATE)
//   body:  Good morning! {{1}} post(s) are waiting for your OK today.
//          Reply *today* to see them, or *approve all* to let them go out.
//
// Once a day per workspace, from 9am in its own timezone, at whatever pass first finds it
// due. Missing a morning is better than sending two.

export const DIGEST_HOUR = 9;

/** The calendar date and hour in a timezone, without pulling in a date library. */
export function localParts(at: number, tz: string): { date: string; hour: number } {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(at);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
}

export function digestDue(now: number, tz: string, lastSentAt: number | null): boolean {
  const today = localParts(now, tz);
  if (today.hour < DIGEST_HOUR) return false;
  return lastSentAt === null || localParts(lastSentAt, tz).date !== today.date;
}

export type DigestResult = { sent: number; skippedNothingWaiting: number; notDue: number; failed: number };

export async function sendDigests(
  deps: Pick<AssistantDeps, "store" | "approvals" | "timezone" | "now">,
  send: (to: string, count: number) => Promise<unknown>,
  until: number,
): Promise<DigestResult> {
  const r: DigestResult = { sent: 0, skippedNothingWaiting: 0, notDue: 0, failed: 0 };
  for (const link of await deps.store.allLinks()) {
    if (Date.now() >= until) break;
    const now = deps.now();
    const tz = await deps.timezone(link.workspace);
    if (!digestDue(now, tz, await deps.store.lastDigest(link.workspace))) { r.notDue++; continue; }
    const waiting = (await deps.approvals.pending(link.workspace)).length;
    if (!waiting) { r.skippedNothingWaiting++; continue; }
    try {
      await send(link.waId, waiting);
      await deps.store.markDigest(link.workspace, now);
      r.sent++;
    } catch {
      r.failed++;
    }
  }
  return r;
}

export function digestTemplate(): { name: string; language: string } {
  return { name: process.env.WHATSAPP_DIGEST_TEMPLATE || "daily_plan", language: process.env.WHATSAPP_DIGEST_LANGUAGE || "en" };
}

export type { CloudConfig };
