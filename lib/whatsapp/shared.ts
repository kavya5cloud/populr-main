import { db } from "@/lib/db";
import { automationRepo } from "@/lib/automation/shared";
import { setState } from "@/lib/automation/engine";
import { getWorkspaceTimezone } from "@/lib/i18n/regions";
import { loadCanonicalProfile } from "@/lib/services/cmo-context";
import { marketPlatform } from "@/lib/market/shared";
import { runResearch } from "@/lib/agents/live/research";
import { url } from "@/lib/seo";
import { InMemoryWhatsAppStore, NeonWhatsAppStore, type WhatsAppStore } from "./links";
import type { AssistantDeps, PendingPost } from "./assistant";

// The real wiring behind the WhatsApp assistant: the automation queue for approvals, the
// live research agents for questions, and the link store. Kept apart from assistant.ts so
// the conversation logic can be tested without any of it.

let store: WhatsAppStore | null = null;
export function whatsappStore(): WhatsAppStore {
  if (!store) {
    const sql = db();
    store = sql ? new NeonWhatsAppStore(sql) : new InMemoryWhatsAppStore();
  }
  return store;
}

/** Waiting posts, soonest first, capped so a list fits comfortably in one message. */
async function pending(workspace: string): Promise<PendingPost[]> {
  const repo = automationRepo();
  const [queue, autos] = await Promise.all([repo.listQueue(workspace), repo.listAutomations(workspace).catch(() => [])]);
  const statement = new Map(autos.map((a) => [a.id, a.statement]));
  return queue
    .filter((q) => q.state === "waiting_approval")
    .sort((a, b) => a.at - b.at)
    .slice(0, 9)
    .map((q) => ({ id: q.id, platform: q.platform, at: q.at, label: (statement.get(q.automationId) ?? "Scheduled post").slice(0, 120) }));
}

/** Moves slots through the same guarded transitions the app uses. */
async function transition(workspace: string, ids: string[], next: "upcoming" | "cancelled"): Promise<number> {
  const repo = automationRepo();
  let queue = await repo.listQueue(workspace);
  const changed: string[] = [];
  for (const id of ids) {
    const r = setState(queue, id, next);
    if (r.ok) { queue = r.queue; changed.push(id); }
  }
  if (changed.length) await repo.saveQueue(queue.filter((q) => changed.includes(q.id)));
  return changed.length;
}

export function assistantDeps(): AssistantDeps {
  return {
    store: whatsappStore(),
    now: Date.now,
    approvals: {
      pending,
      approve: (ws, ids) => transition(ws, ids, "upcoming"),
      skip: (ws, ids) => transition(ws, ids, "cancelled"),
    },
    async research(workspace, question) {
      const sql = db();
      const profile = sql ? await loadCanonicalProfile(sql, workspace).catch(() => null) : null;
      let answer = "";
      let sources: { title: string; url: string }[] = [];
      for await (const e of runResearch(
        { tenant: workspace, question, brand: { name: profile?.name, oneLiner: profile?.oneLiner, audience: profile?.audience } },
        { aggregator: marketPlatform().aggregator, signal: AbortSignal.timeout(40_000) },
      )) {
        if (e.type === "answer") answer = e.text;
        if (e.type === "sources") sources = e.sources.map((s) => ({ title: s.title, url: s.url }));
      }
      return sources.length && answer ? { answer, sources } : null;
    },
    timezone: (ws) => getWorkspaceTimezone(db(), ws).catch(() => "Asia/Kolkata"),
    appUrl: url("/app"),
    customers: {
      async open(ws) {
        const { businessStore } = await import("./business/shared");
        return (await businessStore().openEscalations(ws)).map((e) => ({ ref: e.ref, question: e.question }));
      },
      async reply(ws, ref, answer) {
        const { businessStore, businessConfig } = await import("./business/shared");
        const { answerCustomer } = await import("./business/flow");
        return answerCustomer(ws, ref, answer, { business: businessStore(), businessConfig, now: Date.now });
      },
    },
  };
}
