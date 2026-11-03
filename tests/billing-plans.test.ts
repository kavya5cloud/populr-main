import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { ANON_AI_ACTIONS, ANON_IP_PER_DAY, FREE_AI_ACTIONS, PRICE, trialDaysFor, TRIAL_CUTOVER, TRIAL_DAYS, YEARLY_MONTHS_FREE } from "@/lib/billing/plans";
import { NeonUsageRepo } from "@/lib/billing/usage-store";
import { noticeDue, noticeEmail } from "@/lib/billing/notices";
import { autoFixNewPage } from "@/lib/seo/autopilot-auto";
import { InMemoryAutopilotStore } from "@/lib/seo/autopilot-store";

// The free plan, the trial, and who is refused what.

const state = vi.hoisted(() => ({
  access: { allowed: false, reason: "trial_ended", until: null } as { allowed: boolean; reason: string; until: number | null },
  usage: new Map<string, number>(),
  site: null as string | null,
  session: null as { userId: string; email: string } | null,
  cookies: new Map<string, string>(),
  checkouts: [] as string[],
}));

vi.mock("@/lib/billing/gate", () => ({
  accessForUser: async () => state.access,
  trialEndsAt: async () => null,
}));
vi.mock("@/lib/billing/usage-store", async (load) => ({
  ...(await load<typeof import("@/lib/billing/usage-store")>()),
  usageRepo: () => ({
    add: async (s: string, p: string, n: number) => { const k = `${s}|${p}`; const v = (state.usage.get(k) ?? 0) + n; state.usage.set(k, v); return v; },
    get: async (s: string, p: string) => state.usage.get(`${s}|${p}`) ?? 0,
    prune: async () => undefined,
  }),
}));
vi.mock("@/lib/db", async (load) => ({
  ...(await load<typeof import("@/lib/db")>()),
  db: () => (async () => (state.site ? [{ host: state.site }] : [])) as never,
}));
vi.mock("@/lib/auth", () => ({ getSession: async () => state.session }));
vi.mock("@polar-sh/nextjs", () => ({
  Checkout: () => async (req: Request) => {
    state.checkouts.push(new URL(req.url).searchParams.get("products") ?? "");
    return new Response(null, { status: 302, headers: { location: "https://polar.test/checkout" } });
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => { const value = state.cookies.get(k); return value ? { value } : undefined; },
    set: (k: string, v: string) => { state.cookies.set(k, v); },
  }),
}));

const { aiGate, backgroundAllowed, checkAccount, checkTool, checkVisitor, monthOf, nextReset, planFor } = await import("@/lib/billing/meter");

const NOW = Date.UTC(2026, 10, 20);
const USER = "u1";
const usedKey = `user:${USER}|${monthOf(NOW)}`;
const lapsed = { allowed: false, reason: "trial_ended", until: null };
const headers = (ip = "203.0.113.9") => new Headers({ "x-forwarded-for": ip });

beforeEach(() => {
  state.access = { ...lapsed };
  state.usage.clear();
  state.cookies.clear();
  state.site = null;
  state.session = null;
  vi.stubEnv("BILLING_ENFORCE", "on");
});
afterEach(() => vi.unstubAllEnvs());

describe("the trial", () => {
  const after = TRIAL_CUTOVER + 1;

  it("is 14 days for someone signing up now", () => {
    expect(TRIAL_DAYS).toBe(14);
    expect(trialDaysFor(after, false)).toBe(14);
  });

  it("stays at 30 for accounts that signed up on the promise of a free month", () => {
    expect(trialDaysFor(TRIAL_CUTOVER - 1, false)).toBe(30);
  });

  it("stays at 30 through a referral link, which says the first month is free", () => {
    expect(trialDaysFor(after, true)).toBe(30);
    expect(readFileSync("app/join/[code]/page.tsx", "utf8")).toMatch(/first month is free/i);
  });
});

describe("the prices", () => {
  it("are what was decided, and yearly is the two months free it says", () => {
    expect(PRICE).toMatchObject({ monthly: 15, yearly: 150 });
    expect(YEARLY_MONTHS_FREE).toBe(2);
  });

  it("the pricing section has no struck-through price nobody ever paid", () => {
    const page = readFileSync("app/page.tsx", "utf8");
    expect(page).not.toMatch(/\$49/);
    expect(page).not.toMatch(/className="was"/);
  });
});

describe("an account with full access", () => {
  it("is never counted or refused", async () => {
    state.access = { allowed: true, reason: "subscription", until: null };
    expect(await checkAccount(USER, { paidOnly: true }, NOW)).toBeNull();
    expect(await checkAccount(USER, {}, NOW)).toBeNull();
    expect(state.usage.size).toBe(0);
  });
});

describe("the free plan", () => {
  it("gives the monthly allowance, then refuses with a way to pay", async () => {
    for (let i = 0; i < FREE_AI_ACTIONS; i++) expect(await checkAccount(USER, {}, NOW)).toBeNull();
    const refused = await checkAccount(USER, {}, NOW);
    expect(refused).toMatchObject({ status: 402, error: "free_limit" });
    expect(refused!.hint).toContain(`$${PRICE.monthly}`);
  });

  it("starts again next month", async () => {
    state.usage.set(usedKey, FREE_AI_ACTIONS);
    expect(await checkAccount(USER, {}, NOW)).not.toBeNull();
    expect(await checkAccount(USER, {}, nextReset(NOW))).toBeNull();
  });

  it("charges an action by the calls it makes", async () => {
    await checkAccount(USER, { cost: 4 }, NOW);
    expect(state.usage.get(usedKey)).toBe(4);
  });

  it("doesn't include images, video or automatic mode, and doesn't charge for refusing them", async () => {
    expect(await checkAccount(USER, { paidOnly: true }, NOW)).toMatchObject({ status: 402, error: "plan_required" });
    expect(state.usage.size).toBe(0);
  });

  it("covers one site", async () => {
    state.site = "bakery.in";
    expect(await checkAccount(USER, { siteUrl: "https://www.bakery.in/about" }, NOW)).toBeNull();
    const other = await checkAccount(USER, { siteUrl: "https://other.com/" }, NOW);
    expect(other).toMatchObject({ status: 402, error: "free_one_site" });
    expect(other!.hint).toContain("bakery.in");
  });

  it("lets a first site through when none has been analyzed yet", async () => {
    expect(await checkAccount(USER, { siteUrl: "https://anything.in/" }, NOW)).toBeNull();
  });

  it("a failed payment falls to the free plan too", async () => {
    state.access = { allowed: false, reason: "payment_failed", until: null };
    expect(await checkAccount(USER, {}, NOW)).toBeNull();
    expect((await planFor(USER, state.access as never, NOW)).tier).toBe("free");
  });
});

describe("a visitor with no account", () => {
  it("gets one analysis, then is asked to sign up", async () => {
    for (let i = 0; i < ANON_AI_ACTIONS; i++) expect(await checkVisitor(headers(), {}, NOW)).toBeNull();
    expect(await checkVisitor(headers(), {}, NOW)).toMatchObject({ status: 401, error: "sign_in_required" });
  });

  it("isn't locked out by someone else on the same network", async () => {
    // Mobile networks in India put many people behind one address, so the browser counts first.
    for (let i = 0; i < ANON_AI_ACTIONS + 1; i++) await checkVisitor(headers(), {}, NOW);
    state.cookies.clear();
    expect(await checkVisitor(headers(), {}, NOW)).toBeNull();
  });

  it("can't clear cookies forever", async () => {
    let refused = null;
    for (let i = 0; i < ANON_IP_PER_DAY + 1; i++) { state.cookies.clear(); refused = await checkVisitor(headers(), {}, NOW); }
    expect(refused).toMatchObject({ error: "sign_in_required" });
  });

  it("never stores a network address as it arrived", async () => {
    await checkVisitor(headers("203.0.113.77"), {}, NOW);
    expect([...state.usage.keys()].join()).not.toContain("203.0.113.77");
  });

  it("gets nothing that costs real money", async () => {
    expect(await checkVisitor(headers(), { paidOnly: true }, NOW)).toMatchObject({ error: "sign_in_required" });
  });
});

describe("with enforcement off, as it ships", () => {
  beforeEach(() => vi.stubEnv("BILLING_ENFORCE", ""));

  it("refuses nobody, so a broken checkout can't lock anyone out", async () => {
    state.usage.set(usedKey, 999);
    expect(await checkAccount(USER, {}, NOW)).toBeNull();
    expect(await checkAccount(USER, { paidOnly: true }, NOW)).toBeNull();
    for (let i = 0; i < ANON_AI_ACTIONS + 5; i++) expect(await checkVisitor(headers(), {}, NOW)).toBeNull();
    expect(await backgroundAllowed("user:u1")).toBe(true);
    expect(await checkTool("user:u1", "turn_on")).toBeNull();
  });

  it("still counts accounts, so the numbers are real on the day it goes on", async () => {
    await checkAccount(USER, {}, NOW);
    expect(state.usage.get(usedKey)).toBe(1);
  });

  it("doesn't tell anyone they've run out, because nothing would stop them", async () => {
    state.usage.set(usedKey, 999);
    expect((await planFor(USER, lapsed as never, NOW)).exhausted).toBe(false);
  });
});

describe("what the screens are told", () => {
  it("says run out only when the gate would refuse, and never shows more than the limit", async () => {
    state.usage.set(usedKey, FREE_AI_ACTIONS + 7);
    const plan = await planFor(USER, lapsed as never, NOW);
    expect(plan).toMatchObject({ tier: "free", exhausted: true, aiUsed: FREE_AI_ACTIONS, aiLimit: FREE_AI_ACTIONS });
  });

  it("offers yearly only when there is a yearly product to sell", async () => {
    vi.stubEnv("POLAR_ACCESS_TOKEN", "t"); vi.stubEnv("POLAR_PRODUCT_ID", "m");
    expect((await planFor(USER, lapsed as never, NOW)).canSubscribeYearly).toBe(false);
    vi.stubEnv("POLAR_PRODUCT_ID_YEARLY", "y");
    expect((await planFor(USER, lapsed as never, NOW)).canSubscribeYearly).toBe(true);
  });

  it("calls a subscriber paid and a trial a trial", async () => {
    expect((await planFor(USER, { allowed: true, reason: "subscription", until: null } as never, NOW)).tier).toBe("paid");
    expect((await planFor(USER, { allowed: true, reason: "trial", until: NOW } as never, NOW)).tier).toBe("trial");
  });
});

describe("choosing a plan at checkout", () => {
  const go = async (query: string) => {
    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/billing/checkout/route");
    state.session = { userId: USER, email: "a@b.c" };
    return GET(new NextRequest(`https://x.test/api/billing/checkout${query}`));
  };
  beforeEach(() => {
    state.checkouts.length = 0;
    vi.stubEnv("POLAR_ACCESS_TOKEN", "t");
    vi.stubEnv("POLAR_PRODUCT_ID", "monthly-id");
  });

  it("sells monthly unless yearly is asked for", async () => {
    vi.stubEnv("POLAR_PRODUCT_ID_YEARLY", "yearly-id");
    await go("");
    await go("?plan=yearly");
    expect(state.checkouts).toEqual(["monthly-id", "yearly-id"]);
  });

  it("can't be talked into any other product", async () => {
    vi.stubEnv("POLAR_PRODUCT_ID_YEARLY", "yearly-id");
    await go("?products=someone-elses&plan=anything");
    expect(state.checkouts).toEqual(["monthly-id"]);
  });

  it("says yearly isn't open, and charges nothing, when there's no yearly product", async () => {
    const res = await go("?plan=yearly");
    expect(res.headers.get("location")).toContain("billing=yearly_unavailable");
    expect(state.checkouts).toEqual([]);
  });
});

describe("the route gate", () => {
  it("answers in the shape both the dashboard and the studio read", async () => {
    state.session = { userId: USER, email: "a@b.c" };
    state.usage.set(usedKey, FREE_AI_ACTIONS);
    const res = await aiGate({ headers: headers() });
    expect(res!.status).toBe(402);
    const body = await res!.json();
    expect(body.error).toBe("free_limit");
    expect(body.hint).toBeTruthy();
    expect(body.message).toBe(body.hint);
  });
});

describe("the editor connection", () => {
  it("lets every tool that only reads through", async () => {
    state.usage.set(usedKey, 999);
    for (const t of ["seo_status", "get_seo_fixes", "audit_page", "verify_page"]) expect(await checkTool("user:u1", t)).toBeNull();
  });

  it("tells the assistant why turning on needs a plan", async () => {
    expect(await checkTool("user:u1", "turn_on")).toContain("trypopulr.in/account");
    state.access = { allowed: true, reason: "trial", until: null };
    expect(await checkTool("user:u1", "turn_on")).toBeNull();
  });

  it("counts a drafted fix against the free allowance", async () => {
    expect(await checkTool("user:u1", "draft_page_fix")).toBeNull();
    expect([...state.usage.values()]).toEqual([1]);
  });
});

describe("work nobody just asked for", () => {
  it("stops for an account without full access, and for a workspace with no account", async () => {
    expect(await backgroundAllowed("user:u1")).toBe(false);
    expect(await backgroundAllowed("anon:abc")).toBe(false);
    state.access = { allowed: true, reason: "trial", until: null };
    expect(await backgroundAllowed("user:u1")).toBe(true);
  });

  it("automatic mode spends nothing for a lapsed account, and keeps the fixes it already made", async () => {
    const store = new InMemoryAutopilotStore();
    const live = { title: "Kept", status: "approved" as const, at: 1 };
    const c = await store.save({ workspace: "user:u1", site: "https://a.in/", enabled: true, auto: true, business: null, faq: [], pages: { "/live": live } });
    const suggest = vi.fn();
    const r = await autoFixNewPage(store, c.siteKey!, "/new", { allowed: async () => false, suggest: suggest as never, fetch: async () => ({ status: 200, text: "<title>x</title>" }) });
    expect(r).toBeNull();
    expect(suggest).not.toHaveBeenCalled();
    const after = await store.byKey(c.siteKey!);
    expect(after!.pages["/live"]).toMatchObject({ title: "Kept", status: "approved" });
    expect(after!.autoDay).toBeUndefined();
  });
});

describe("every route that spends AI asks", () => {
  // Written out, because a route added next month with no check is exactly the bug this closes:
  // nothing fails, nobody reports being over-served, and the bill just goes up.
  const metered = [
    "generate", "generate/stream", "geo", "cmo/ask", "cmo/respond", "content/compose", "content/edit",
    "content/generate", "content/refine", "creative/generate", "agents/research", "market/research",
    "launch/command", "ugc", "voice/turn", "seo/autopilot",
  ];

  it.each(metered)("%s", (route) => {
    expect(readFileSync(`app/api/${route}/route.ts`, "utf8")).toMatch(/await aiGate\(req/);
  });

  it("the routes that call a model directly are all on the list", () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap((e) => { const p = `${d}/${e}`; return statSync(p).isDirectory() ? walk(p) : e === "route.ts" ? [p] : []; });
    const direct = walk("app/api")
      .filter((f) => /lib\/services\/llm(-stream)?"/.test(readFileSync(f, "utf8")))
      .filter((f) => !/\/(cron|llm|webhooks)\//.test(f))
      .map((f) => f.replace("app/api/", "").replace("/route.ts", ""));
    expect(direct.filter((r) => !metered.includes(r) && !/^(content|providers|market|agents)\//.test(r))).toEqual([]);
  });

  it("the background jobs check before they spend", () => {
    for (const f of ["app/api/cron/agent-pass/route.ts", "app/api/cron/automation-publish/route.ts", "app/api/seo/autopilot/seen/route.ts", "app/api/brief/route.ts"]) {
      expect(readFileSync(f, "utf8"), f).toMatch(/backgroundAllowed/);
    }
  });

  it("the editor connection asks too", () => {
    expect(readFileSync("app/api/mcp/route.ts", "utf8")).toMatch(/checkTool\(/);
  });
});

describe("the trial emails", () => {
  const DAY = 86_400_000;

  it("warn in the last three days, and say so once it's over", () => {
    expect(noticeDue(NOW + 4 * DAY, NOW)).toBeNull();
    expect(noticeDue(NOW + 3 * DAY, NOW)).toBe("trial_ending");
    expect(noticeDue(NOW + 1, NOW)).toBe("trial_ending");
    expect(noticeDue(NOW - DAY, NOW)).toBe("trial_ended");
  });

  it("never reach someone whose trial ended long ago, so switching them on can't mail the whole list", () => {
    expect(noticeDue(NOW - 4 * DAY, NOW)).toBeNull();
    expect(noticeDue(NOW - 90 * DAY, NOW)).toBeNull();
  });

  it("say what happens if you do nothing, and what it costs", () => {
    const soon = noticeEmail("trial_ending", "a@b.c", NOW + 2 * DAY, NOW);
    expect(soon.subject).toContain("2 days");
    const one = noticeEmail("trial_ending", "a@b.c", NOW + DAY, NOW);
    expect(one.subject).toContain("1 day");
    expect(one.subject).not.toContain("1 days");
    for (const m of [soon, noticeEmail("trial_ended", "a@b.c", NOW - DAY, NOW)]) {
      expect(m.text).toContain(`$${PRICE.monthly}`);
      expect(m.text).toContain(`$${PRICE.yearly}`);
      expect(m.text).toContain(String(FREE_AI_ACTIONS));
      expect(m.text).toMatch(/stay live/);
    }
  });

  it("are scheduled, and the route needs the cron secret", () => {
    expect(existsSync(".github/workflows/trial-reminders.yml")).toBe(true);
    expect(readFileSync("app/api/cron/trial-reminders/route.ts", "utf8")).toMatch(/authCron\(req\)/);
  });
});

describe("the usage table", () => {
  it("adds atomically, keeps periods apart, and forgets old rows", async () => {
    const pg = new PGlite();
    const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) =>
      (await pg.query(strings.reduce((t, part, i) => `${t}$${i}${part}`), values)).rows) as never;
    await pg.exec(readFileSync("db/migrations/20261103_billing_usage.sql", "utf8"));
    const repo = new NeonUsageRepo(sql);
    (repo as unknown as { ready: () => Promise<void> }).ready = async () => undefined;

    const totals = await Promise.all([repo.add("user:a", "2026-11", 1), repo.add("user:a", "2026-11", 1), repo.add("user:a", "2026-11", 4)]);
    expect(Math.max(...totals)).toBe(6);
    expect(await repo.get("user:a", "2026-11")).toBe(6);
    expect(await repo.get("user:a", "2026-12")).toBe(0);
    expect(await repo.get("user:b", "2026-11")).toBe(0);

    await repo.prune(Date.now() + 1000);
    expect(await repo.get("user:a", "2026-11")).toBe(0);
  });
});
