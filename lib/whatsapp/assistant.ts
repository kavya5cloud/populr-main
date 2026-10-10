import type { InboundMessage } from "./cloud";
import type { WhatsAppStore } from "./links";
import { isResearchQuestion } from "@/lib/agents/live/intent";

// What Populr says back on WhatsApp.
//
// Deliberately small. A founder on a phone wants three things: what is going out, a way to
// say yes or no to it, and an answer to a quick question. Anything bigger has a link into
// the app. Commands are matched with rules, never a model — "approve all" is not a phrase to
// leave open to interpretation.
//
// Every action is scoped to the workspace the sender's number is linked to. An unlinked
// number can do exactly one thing: link.

export type PendingPost = { id: string; platform: string; at: number; label: string };

export type AssistantDeps = {
  store: WhatsAppStore;
  now: () => number;
  approvals: {
    pending(workspace: string): Promise<PendingPost[]>;
    approve(workspace: string, ids: string[]): Promise<number>;
    skip(workspace: string, ids: string[]): Promise<number>;
  };
  /** Live research for market questions; null when it found nothing worth sending. */
  research(workspace: string, question: string): Promise<{ answer: string; sources: { title: string; url: string }[] } | null>;
  timezone(workspace: string): Promise<string>;
  appUrl: string;
};

const PLATFORM: Record<string, string> = { linkedin: "LinkedIn", x: "X", instagram: "Instagram", facebook: "Facebook", threads: "Threads", pinterest: "Pinterest", reddit: "Reddit" };

const HELP = [
  "Here's what I can do on WhatsApp:",
  "",
  "*today* — posts waiting for your OK",
  "*approve 1* or *approve all* — let them go out",
  "*skip 2* — don't post that one",
  "Ask about your market — \"what's trending in quick commerce?\" — and I'll check this week's news.",
  "*stop* — disconnect this number",
].join("\n");

function when(at: number, tz: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" }).format(at);
}

/** "1", "1 3", "1,3", "1 and 3" → [1, 3]. */
function numbers(s: string): number[] {
  return [...new Set((s.match(/\d+/g) ?? []).map(Number).filter((n) => n > 0 && n < 100))];
}

export async function handleInbound(msg: InboundMessage, deps: AssistantDeps): Promise<string | null> {
  const text = msg.text.trim();
  const lower = text.toLowerCase();

  // Linking is the one thing an unknown number may do.
  const linkCode = lower.match(/^link\s+(\d{6})$/)?.[1];
  if (linkCode) {
    const workspace = await deps.store.redeemCode(linkCode, deps.now());
    if (!workspace) return "That code didn't work — it may have expired. Open Populr → Settings → WhatsApp for a fresh one.";
    await deps.store.link(msg.from, workspace, deps.now());
    return `You're connected. I'll send your posting plan here, and you can approve posts by replying.\n\n${HELP}`;
  }

  const link = await deps.store.byNumber(msg.from);
  if (!link) {
    return "Hi! This is Populr, your AI CMO. To connect this number, open Populr → Settings → WhatsApp and send me the code shown there.";
  }
  const ws = link.workspace;

  if (/^(stop|unlink|disconnect|unsubscribe)$/.test(lower)) {
    await deps.store.unlink(msg.from);
    return "Disconnected. I won't message this number again. You can reconnect any time from Settings → WhatsApp.";
  }

  if (/^(help|menu|hi|hello|hey|\?)$/.test(lower)) return HELP;

  if (/^(today|plan|pending|queue|what'?s (going out|next)|posts?)$/.test(lower)) {
    const pending = await deps.approvals.pending(ws);
    if (!pending.length) return "Nothing is waiting for you. Anything scheduled will go out on its own.";
    const tz = await deps.timezone(ws);
    return [
      `${pending.length} post${pending.length === 1 ? " is" : "s are"} waiting for your OK:`,
      "",
      ...pending.map((p, i) => `*${i + 1}.* ${PLATFORM[p.platform] ?? p.platform} · ${when(p.at, tz)}\n${p.label}`),
      "",
      "Reply *approve all*, *approve 1*, or *skip 2*.",
    ].join("\n");
  }

  const approveAll = /^(approve|ok|yes|go)( them)? all$|^approve everything$/.test(lower);
  const approveSome = lower.match(/^(approve|ok|yes)\s+(.+)$/);
  const skipSome = lower.match(/^(skip|no|reject|drop)\s+(.+)$/);
  if (approveAll || approveSome || skipSome) {
    // Numbers refer to the list as it stands now. Re-read rather than remembered, so a post
    // that went out or was skipped in the app since can't be approved by a stale number.
    const pending = await deps.approvals.pending(ws);
    if (!pending.length) return "Nothing is waiting for approval right now.";
    if (approveAll) {
      const n = await deps.approvals.approve(ws, pending.map((p) => p.id));
      return `Approved ${n} post${n === 1 ? "" : "s"}. They'll go out at their scheduled times.`;
    }
    const picked = numbers((approveSome ?? skipSome)![2]);
    const ids = picked.map((n) => pending[n - 1]?.id).filter((x): x is string => Boolean(x));
    if (!ids.length) return `I couldn't match that to the list. Reply *today* to see what's waiting — there ${pending.length === 1 ? "is 1" : `are ${pending.length}`}.`;
    if (approveSome) {
      const n = await deps.approvals.approve(ws, ids);
      return `Approved ${n}. ${pending.length - n > 0 ? `${pending.length - n} still waiting — reply *today* to see them.` : "Nothing else is waiting."}`;
    }
    const n = await deps.approvals.skip(ws, ids);
    return `Skipped ${n}. ${n === 1 ? "It" : "They"} won't be posted.`;
  }

  if (isResearchQuestion(text)) {
    const r = await deps.research(ws, text);
    if (!r) return "I couldn't find anything published about that this week. Try a broader topic, or ask about a competitor by their website.";
    const sources = r.sources.slice(0, 3).map((s, i) => `[${i + 1}] ${s.title}\n${s.url}`).join("\n\n");
    return `${r.answer}${sources ? `\n\n${sources}` : ""}`;
  }

  return `I'm best at your posts and your market on WhatsApp — reply *help* to see what I can do. For anything bigger, it's all in the app: ${deps.appUrl}`;
}
