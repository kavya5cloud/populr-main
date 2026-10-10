import { sendTemplate, sendText, WhatsAppSendError, type CloudConfig, type InboundMessage } from "../cloud";
import { maskNumber, type WhatsAppStore } from "../links";
import { decide, holdingReply, type Decision, type Knowledge } from "./agent";
import type { BusinessConnection, BusinessStore, Escalation } from "./store";

// A customer writes to the business's WhatsApp. Populr answers what it can and asks the
// founder about the rest; the founder's answer goes back to the customer and is remembered.
//
//   customer ── question ──▶ agent ──┬── answered from what the business wrote ──▶ customer
//                                    └── "let me check with the team" ─────────▶ customer
//                                         question (#12) ─────────▶ founder's WhatsApp / Settings
//   founder ── "reply 12 Yes, we deliver to Kothrud" ──▶ customer, and learned for next time

/** Beyond this many messages an hour from one customer, the agent stops replying. */
export const CUSTOMER_HOURLY_LIMIT = 15;

export type FlowDeps = {
  business: BusinessStore;
  founderLinks: WhatsAppStore;
  /** Populr's own number, for messaging the founder. Null if WhatsApp isn't set up on Populr's side. */
  populrCloud: CloudConfig | null;
  knowledgeFor(conn: BusinessConnection): Promise<Knowledge>;
  decide?: (message: string, k: Knowledge) => Promise<Decision>;
  send?: typeof sendText;
  sendTemplate?: typeof sendTemplate;
  now: () => number;
};

export type CustomerOutcome = "answered" | "escalated" | "ignored_disabled" | "rate_limited" | "opted_out" | "duplicate";

export async function handleCustomerMessage(conn: BusinessConnection, businessCfg: CloudConfig, msg: InboundMessage, deps: FlowDeps): Promise<CustomerOutcome> {
  const send = deps.send ?? sendText;
  if (!(await deps.business.firstSeen(msg.id, deps.now()))) return "duplicate";
  // Off means the business answers its own messages; Populr stays silent rather than talking
  // over a person.
  if (!conn.enabled) return "ignored_disabled";
  if ((await deps.business.hit(conn.id, msg.from, deps.now())) > CUSTOMER_HOURLY_LIMIT) return "rate_limited";

  if (/^(stop|unsubscribe)$/i.test(msg.text.trim())) {
    await send(businessCfg, msg.from, "Understood — you won't get automated replies from us. Message any time if you need anything.");
    return "opted_out";
  }

  const knowledge = await deps.knowledgeFor(conn);
  const decision = await (deps.decide ?? ((m, k) => decide(m, k)))(msg.text, knowledge);

  if (decision.kind === "answer") {
    await send(businessCfg, msg.from, decision.text);
    return "answered";
  }

  const esc = await deps.business.escalate({ connectionId: conn.id, workspace: conn.workspace, customer: msg.from, question: msg.text.slice(0, 1000), askedAt: deps.now() });
  await send(businessCfg, msg.from, holdingReply(knowledge.businessName));
  await notifyFounder(esc, deps).catch(() => { /* the question still waits in Settings */ });
  return "escalated";
}

/**
 * Tell the founder a customer is waiting.
 *
 * Over their linked PA if there is one. A plain message works only inside WhatsApp's
 * 24-hour window — if the founder hasn't written to Populr in a day, it falls back to the
 * approved `customer_question` template. Not linked at all, the question waits in Settings.
 */
async function notifyFounder(esc: Escalation, deps: FlowDeps): Promise<void> {
  const link = await deps.founderLinks.byWorkspace(esc.workspace);
  if (!link || !deps.populrCloud) return;
  const body = [
    `*A customer is waiting* (#${esc.ref}), from ${maskNumber(esc.customer)}:`,
    "",
    `"${esc.question.slice(0, 600)}"`,
    "",
    `Reply *reply ${esc.ref}* followed by your answer, and I'll send it to them.`,
  ].join("\n");
  try {
    await (deps.send ?? sendText)(deps.populrCloud, link.waId, body);
  } catch (e) {
    if (!(e instanceof WhatsAppSendError && e.code === 131047)) throw e;
    // Outside the 24-hour window. Template, created in WhatsApp Manager (Utility, English):
    //   customer_question: "A customer is waiting (#{{1}}): "{{2}}" — reply *reply {{1}}*
    //   followed by your answer and I'll send it to them."
    await (deps.sendTemplate ?? sendTemplate)(deps.populrCloud, link.waId, process.env.WHATSAPP_ESCALATION_TEMPLATE || "customer_question", "en", [String(esc.ref), esc.question.slice(0, 300)]);
  }
}

/**
 * The founder's answer, sent to the customer and learned.
 *
 * Same path from WhatsApp ("reply 12 …") and from Settings. Returns what to tell the founder.
 */
export async function answerCustomer(
  workspace: string, ref: number, answer: string,
  deps: Pick<FlowDeps, "business" | "now" | "send"> & { businessConfig(conn: BusinessConnection): Promise<CloudConfig | null> },
): Promise<string> {
  const text = answer.trim();
  if (!text) return `Add your answer after the number, like: reply ${ref} Yes, we're open until 9pm.`;
  const esc = await deps.business.openEscalation(workspace, ref);
  if (!esc) return `I don't have an open question #${ref}. It may already be answered.`;
  const conn = await deps.business.get(esc.connectionId);
  const cfg = conn ? await deps.businessConfig(conn) : null;
  if (!conn || !cfg) return "Your business WhatsApp isn't connected any more, so I couldn't send that.";
  try {
    await (deps.send ?? sendText)(cfg, esc.customer, text);
  } catch (e) {
    if (e instanceof WhatsAppSendError && e.code === 131047) {
      return `It's been more than 24 hours since they wrote, so WhatsApp won't let a normal reply through. Message them directly from your WhatsApp Business app.`;
    }
    return "That didn't send — WhatsApp refused it. Try again in a moment.";
  }
  await deps.business.resolve(esc.id, deps.now());
  // Learned only once it has actually gone out: an answer that never reached anyone hasn't
  // been tested against a real customer.
  await deps.business.learn(workspace, { question: esc.question, answer: text, at: deps.now() });
  return `Sent to the customer (#${ref}). I'll answer that myself next time someone asks.`;
}
