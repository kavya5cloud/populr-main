import { createHash, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { requestKey } from "@/lib/throttle";
import type { Access } from "./access";
import { accessForUser } from "./gate";
import { billingConfig } from "./polar";
import { ANON_AI_ACTIONS, ANON_IP_PER_DAY, FREE_AI_ACTIONS, PRICE } from "./plans";
import { usageRepo } from "./usage-store";

// What each kind of person may spend on AI, asked by every route that spends it.
//
// lib/billing/access.ts says whether an account has full access. This says what happens when
// it doesn't: an account falls to the free plan and a visitor gets one look. Before this, the
// paywall only asked signed-in accounts, and only on a few routes, so logging out was enough
// to skip it.
//
// Three things it never does:
//
//   Refuse anyone while BILLING_ENFORCE is off. It stays off until a real payment has gone
//   through production, because a limit whose Subscribe button is broken is a locked door.
//
//   Fail closed. Same rule as lib/billing/gate.ts: if the database is unreachable we cannot
//   prove anyone is over a limit, and our outage should not be the customer's.
//
//   Touch what is already live. Fixes on a customer's site keep being served when they stop
//   paying: this only decides whether new AI work starts.

const COOKIE = "populr_free";
const MONTH_S = 30 * 86_400;

export const enforcing = () => process.env.BILLING_ENFORCE === "on";

export const monthOf = (now: number) => new Date(now).toISOString().slice(0, 7);
const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10);

/** The first moment of next month, when a free allowance starts again. */
export function nextReset(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

const hashed = (value: string) => createHash("sha256").update(`${process.env.AUTH_SECRET ?? ""}:${value}`).digest("hex").slice(0, 32);
const hostOf = (raw: string) => { try { return new URL(raw).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };

export type GateOpts = {
  /** Model calls this action makes, when one request makes several. */
  cost?: number;
  /** Not on the free plan at all: images, video, automatic mode. */
  paidOnly?: boolean;
  /** The site this action reads, on routes that name one. The free plan covers one site. */
  siteUrl?: string | null;
};

export type Refusal = { status: 401 | 402; error: "sign_in_required" | "plan_required" | "free_limit" | "free_one_site"; hint: string };

const SUBSCRIBE = `Subscribe for $${PRICE.monthly} a month or $${PRICE.yearly} a year.`;

const REFUSE = {
  signIn: (): Refusal => ({ status: 401, error: "sign_in_required", hint: "Create a free account to keep going. Your analysis carries over." }),
  paid: (): Refusal => ({ status: 402, error: "plan_required", hint: `This isn't part of the free plan. ${SUBSCRIBE}` }),
  limit: (): Refusal => ({ status: 402, error: "free_limit", hint: `You've used this month's ${FREE_AI_ACTIONS} free AI actions. ${SUBSCRIBE}` }),
  oneSite: (site: string): Refusal => ({ status: 402, error: "free_one_site", hint: `The free plan covers one site, and yours is ${site}. ${SUBSCRIBE}` }),
};

/** The site a free account has been working on, or null if it hasn't analyzed one yet. */
async function siteOf(userId: string): Promise<string | null> {
  const sql = db();
  if (!sql) return null;
  const rows = (await sql`
    SELECT host FROM websites WHERE workspace_key = ${`user:${userId}`}
    ORDER BY last_analyzed_at DESC LIMIT 1`) as { host: string }[];
  return rows[0]?.host ? rows[0].host.replace(/^www\./, "").toLowerCase() : null;
}

/** An account's answer. Free-plan usage is counted even with enforcement off, so the numbers are real on the day it's switched on. */
export async function checkAccount(userId: string, opts: GateOpts = {}, now: number = Date.now()): Promise<Refusal | null> {
  const access = await accessForUser(userId, now);
  if (access.allowed) return null;
  const on = enforcing();

  if (opts.paidOnly) return on ? REFUSE.paid() : null;

  if (on && opts.siteUrl) {
    const site = await siteOf(userId).catch(() => null);
    const asked = hostOf(opts.siteUrl);
    if (site && asked && asked !== site) return REFUSE.oneSite(site);
  }

  const used = await usageRepo().add(`user:${userId}`, monthOf(now), opts.cost ?? 1).catch(() => 0);
  return on && used > FREE_AI_ACTIONS ? REFUSE.limit() : null;
}

/** Who this browser is, for the no-account limit. A random id, tied to nothing else. */
async function browserId(): Promise<string> {
  const jar = await cookies();
  const known = jar.get(COOKIE)?.value;
  if (known && /^[a-f0-9-]{36}$/.test(known)) return known;
  const id = randomUUID();
  jar.set(COOKIE, id, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: MONTH_S });
  return id;
}

/** A visitor's answer: one site analysis, counted per browser and, more loosely, per network. */
export async function checkVisitor(headers: Headers, opts: GateOpts = {}, now: number = Date.now()): Promise<Refusal | null> {
  if (!enforcing()) return null;
  if (opts.paidOnly) return REFUSE.signIn();
  try {
    const repo = usageRepo();
    const cost = opts.cost ?? 1;
    const [browser, network] = await Promise.all([
      browserId().then((id) => repo.add(`anon:${hashed(id)}`, monthOf(now), cost)),
      repo.add(`ip:${hashed(requestKey(headers))}`, dayOf(now), cost),
    ]);
    return browser > ANON_AI_ACTIONS || network > ANON_IP_PER_DAY ? REFUSE.signIn() : null;
  } catch {
    return null;
  }
}

/**
 * The gate, in the shape an API route needs. Null means carry on.
 *
 * With no database there are no accounts and nothing to count against: the local demo stands.
 */
export async function aiGate(req: { headers: Headers }, opts: GateOpts = {}): Promise<NextResponse | null> {
  if (!db()) return null;
  const session = await getSession();
  const refused = session ? await checkAccount(session.userId, opts) : await checkVisitor(req.headers, opts);
  if (!refused) return null;
  // `hint` is what the dashboard reads and `message` what the studio reads.
  return NextResponse.json({ error: refused.error, hint: refused.hint, message: refused.hint }, { status: refused.status });
}

const accountOf = (workspace: string) => (workspace.startsWith("user:") ? workspace.slice("user:".length) : null);

/** Tools an editor can call that make Populr spend AI. The rest only read or save settings. */
const PAID_TOOLS = new Set(["turn_on"]);
const METERED_TOOLS = new Set(["draft_page_fix"]);

/** The editor connection's answer, as a sentence the assistant can pass on. Null means carry on. */
export async function checkTool(workspace: string, tool: unknown): Promise<string | null> {
  const name = String(tool ?? "");
  if (!PAID_TOOLS.has(name) && !METERED_TOOLS.has(name)) return null;
  const userId = accountOf(workspace);
  if (!userId || !db()) return null;
  const refused = await checkAccount(userId, { paidOnly: PAID_TOOLS.has(name) });
  return refused ? `${refused.hint} Manage your plan at https://www.trypopulr.in/account` : null;
}

/**
 * Whether work nobody just asked for may start for this workspace: automatic fixes, the daily
 * agent pass, scheduled posts. Part of the paid plan, and not for a workspace with no account.
 * Fixes already approved keep being served whatever this says.
 */
export async function backgroundAllowed(workspace: string): Promise<boolean> {
  if (!enforcing() || !db()) return true;
  const userId = accountOf(workspace);
  if (!userId) return false;
  return (await accessForUser(userId)).allowed;
}

export type PlanSnapshot = {
  tier: "paid" | "trial" | "free";
  aiUsed: number;
  aiLimit: number;
  /** True only when refusals are real, so the screen never says no while the gate says yes. */
  exhausted: boolean;
  resetsAt: number;
  canSubscribe: boolean;
  canSubscribeYearly: boolean;
};

/** Where an account stands, for the screens that show it. They render this and decide nothing. */
export async function planFor(userId: string, access: Access, now: number = Date.now()): Promise<PlanSnapshot> {
  const billing = billingConfig();
  const tier = !access.allowed ? "free" : access.reason === "trial" ? "trial" : "paid";
  const used = tier === "free" ? await usageRepo().get(`user:${userId}`, monthOf(now)).catch(() => 0) : 0;
  return {
    tier,
    aiUsed: Math.min(used, FREE_AI_ACTIONS),
    aiLimit: FREE_AI_ACTIONS,
    exhausted: tier === "free" && enforcing() && used >= FREE_AI_ACTIONS,
    resetsAt: nextReset(now),
    canSubscribe: billing.configured,
    canSubscribeYearly: billing.configured && Boolean(billing.yearlyProductId),
  };
}
