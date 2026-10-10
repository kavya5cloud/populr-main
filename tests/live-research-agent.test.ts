import { afterEach, describe, expect, it, vi } from "vitest";
import { competitorSites, isResearchQuestion, searchTermsFor } from "@/lib/agents/live/intent";
import { runResearch, type ResearchEvent } from "@/lib/agents/live/research";
import type { SignalAggregator } from "@/lib/market/aggregator";

// The research and strategy agents in chat. What matters: market questions reach them and
// writing requests do not; they search for the topic rather than the word "market"; and the
// answer is grounded in what was found or not given at all.

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

describe("which messages go to the live agents", () => {
  it("takes market questions", () => {
    for (const q of ["What's trending in quick commerce?", "what are competitors doing", "Any news about D2C skincare this week?", "what are people saying on reddit about meal kits"]) {
      expect(isResearchQuestion(q), q).toBe(true);
    }
  });

  it("leaves advice questions with the CMO, even with a time phrase or market word", () => {
    // "this week" alone once routed this to research, which searched the news for
    // "linkedin grocery" and answered from a court case and an RBI rule.
    for (const q of ["What should I post on LinkedIn this week for my grocery store?", "how do I beat my competitors?", "what should we do about the market slowdown?"]) {
      expect(isResearchQuestion(q), q).toBe(false);
    }
  });

  it("leaves requests to write something with the writer", () => {
    for (const q of ["Write a LinkedIn post about the latest trend", "draft a thread on market news", "give me a post about competitors"]) {
      expect(isResearchQuestion(q), q).toBe(false);
    }
  });
});

describe("what it searches for", () => {
  it("searches the topic, not the generic words around it", () => {
    // Searching for "market" finds the stock market.
    expect(searchTermsFor("What's trending in quick commerce this week?")).toEqual(["quick commerce"]);
  });

  it("honours a quoted phrase exactly", () => {
    expect(searchTermsFor('any news on "dark stores" or "10 minute delivery"?')).toEqual(["dark stores", "10 minute delivery"]);
  });

  it("falls back to what the business does when the question names no topic", () => {
    expect(searchTermsFor("what are competitors doing?", { oneLiner: "Organic skincare for Indian summers" })).toEqual(["organic skincare"]);
  });

  it("only treats sites as competitors, never bare names", () => {
    expect(competitorSites("what is zepto.com doing?", { competitors: ["Blinkit", "https://swiggy.com"] }))
      .toEqual(["zepto.com", "Blinkit", "https://swiggy.com"]);
    // Bare names pass through here; the competitor source itself skips any without a domain.
  });
});

function fakeAggregator(by: Record<string, { items?: { title: string; url: string }[]; fail?: string }>): SignalAggregator {
  return {
    collect: async (_q: unknown, sources: string[]) => {
      const id = sources[0];
      const r = by[id] ?? {};
      if (r.fail) return { signals: [], ok: [], failed: [{ source: id, error: r.fail }], cached: [], collectedAt: 0 };
      const items = r.items ?? [];
      return {
        signals: items.length ? [{ id: "s", source: id, kind: "article", topic: "t", title: `${items.length} found`, strength: 0.5, velocity: 0.5, observedAt: 0, raw: { items: items.map((i) => ({ ...i, publishedAt: null })) } }] : [],
        ok: [id], failed: [], cached: [], collectedAt: 0,
      };
    },
  } as unknown as SignalAggregator;
}

async function collect(gen: AsyncGenerator<ResearchEvent>) {
  const events: ResearchEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

describe("the answer is grounded or not given", () => {
  it("with nothing found, answers without calling a model", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const events = await collect(runResearch({ tenant: "t", question: "what's trending in kirana delivery?" }, { aggregator: fakeAggregator({}) }));

    expect(f, "a model was asked to answer from nothing").not.toHaveBeenCalled();
    const answer = events.find((e) => e.type === "answer");
    expect(answer && answer.type === "answer" && answer.text).toMatch(/couldn't find anything/i);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("numbers the sources once and hands the model only those", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk_test");
    let prompt = "";
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
      prompt = JSON.parse(String(init?.body)).messages.find((m: { role: string }) => m.role === "user").content;
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "Dark stores are expanding [1]." } }] }), { status: 200 });
    }));
    const events = await collect(runResearch(
      { tenant: "t", question: "what's happening with dark stores?" },
      { aggregator: fakeAggregator({ news: { items: [{ title: "Dark stores expand in Pune", url: "https://n/1" }] } }) },
    ));

    const sources = events.find((e) => e.type === "sources");
    expect(sources && sources.type === "sources" && sources.sources.map((s) => [s.n, s.title])).toEqual([[1, "Dark stores expand in Pune"]]);
    expect(prompt).toContain("[1] (News) Dark stores expand in Pune");
    expect(prompt).toMatch(/Never invent numbers/);
  });

  it("reports a source that could not run, with the reason, instead of leaving it out", async () => {
    const events = await collect(runResearch(
      { tenant: "t", question: "what are people saying about meal kits?" },
      { aggregator: fakeAggregator({ reddit: { fail: "reddit failed: Error: HTTP 403" } }) },
    ));
    const reddit = events.filter((e) => e.type === "step" && e.step.id === "reddit").at(-1);
    expect(reddit && reddit.type === "step" && reddit.step.status).toBe("skipped");
    expect(reddit && reddit.type === "step" && reddit.step.detail).toMatch(/needs API access/);
  });

  it("announces each step before it finishes it", async () => {
    const events = await collect(runResearch({ tenant: "t", question: "news on quick commerce?" }, { aggregator: fakeAggregator({}) }));
    const news = events.filter((e) => e.type === "step" && e.step.id === "news").map((e) => e.type === "step" && e.step.status);
    expect(news).toEqual(["running", "done"]);
  });
});
