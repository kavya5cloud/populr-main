import type { SignalAggregator } from "@/lib/market/aggregator";
import type { Citation } from "@/lib/market/live-sources";
import type { MarketSourceId } from "@/lib/market/types";
import { generateText } from "@/lib/services/llm";
import { competitorSites, searchTermsFor } from "./intent";

// Live research in chat.
//
// Two agents, run in the open. Research gathers what is actually out there this week —
// news, Reddit, competitors' own sites — and Strategy reads only that and says what it means
// for this business, citing each claim by number. Every step is reported as it starts and
// finishes, so the founder watches the work rather than a spinner, and a step that could not
// run says why instead of being quietly left out.
//
// The answer is grounded or it is not given. With no sources, there is no model call: the
// reply says nothing was found, which is the true answer and the one a model asked to be
// helpful would most reliably get wrong.

export type AgentStep = {
  id: string;
  agent: "research" | "strategy";
  label: string;
  status: "running" | "done" | "skipped" | "failed";
  detail?: string;
};

export type ResearchEvent =
  | { type: "step"; step: AgentStep }
  | { type: "sources"; sources: (Citation & { n: number; via: string })[] }
  | { type: "answer"; text: string }
  | { type: "done" };

export type { ResearchBrand } from "./intent";
export { isResearchQuestion } from "./intent";

export type ResearchInput = {
  tenant: string;
  question: string;
  brand?: import("./intent").ResearchBrand;
};

const VIA: Record<string, string> = { news: "News", reddit: "Reddit", competitor_web: "Competitor site", rss: "Feed" };

export async function* runResearch(
  input: ResearchInput,
  deps: { aggregator: SignalAggregator; signal?: AbortSignal },
): AsyncGenerator<ResearchEvent> {
  const searchTerms = searchTermsFor(input.question, input.brand);
  const competitors = competitorSites(input.question, input.brand);
  const found: (Citation & { via: string })[] = [];

  const gather = async function* (id: string, label: string, source: MarketSourceId, q: { terms: string[]; competitors?: string[] }): AsyncGenerator<ResearchEvent> {
    yield { type: "step", step: { id, agent: "research", label, status: "running" } };
    const res = await deps.aggregator.collect({ tenant: input.tenant, ...q }, [source]).catch(() => null);
    if (!res || res.failed.length) {
      const why = !res ? "unavailable" : /403|auth/i.test(res.failed[0]?.error ?? "")
        ? "needs API access, which isn't connected yet" : "didn't respond";
      yield { type: "step", step: { id, agent: "research", label, status: "skipped", detail: `${VIA[source] ?? source} ${why}` } };
      return;
    }
    const items = res.signals.flatMap((s) => ((s.raw.items as Citation[] | undefined) ?? []).map((c) => ({ ...c, via: VIA[source] ?? source })));
    found.push(...items);
    const counted = res.signals.map((s) => s.title).join("; ");
    yield { type: "step", step: { id, agent: "research", label, status: "done", detail: counted || "Nothing this week" } };
  };

  if (searchTerms.length) {
    const quoted = searchTerms.map((t) => `"${t}"`).join(", ");
    yield* gather("news", `Searching this week's news for ${quoted}`, "news", { terms: searchTerms });
    if (deps.signal?.aborted) return;
    yield* gather("reddit", "Reading what people are saying on Reddit", "reddit", { terms: searchTerms });
    if (deps.signal?.aborted) return;
  } else {
    yield { type: "step", step: { id: "terms", agent: "research", label: "Working out what to search for", status: "skipped", detail: "The question didn't name a topic, and there is no business profile to fall back on" } };
  }
  if (competitors.length) {
    yield* gather("competitors", `Checking what ${competitors.length === 1 ? "your competitor has" : "competitors have"} published`, "competitor_web", { terms: searchTerms.length ? searchTerms : ["x"], competitors });
    if (deps.signal?.aborted) return;
  }

  // Numbered once, here, so the answer's [n] and the list the founder clicks are the same.
  // Some "headlines" are whole LinkedIn posts. Capped for reading, and the model sees the
  // same capped text the founder does, so nothing is cited that isn't on screen.
  const cap = (t: string) => (t.length > 160 ? `${t.slice(0, 157).trimEnd()}…` : t);
  const unique = [...new Map(found.map((c) => [c.url, { ...c, title: cap(c.title) }])).values()].slice(0, 10);
  const sources = unique.map((c, i) => ({ ...c, n: i + 1 }));
  if (sources.length) yield { type: "sources", sources };

  const sid = "strategy";
  if (!sources.length) {
    yield { type: "step", step: { id: sid, agent: "strategy", label: "Deciding what this means for you", status: "skipped", detail: "Nothing to reason from" } };
    yield {
      type: "answer",
      text: searchTerms.length
        ? `I couldn't find anything published about ${searchTerms.map((t) => `"${t}"`).join(" or ")} this week. That is itself useful: there is no wave to ride here right now. Try a broader term, or ask about a competitor by their website.`
        : "Tell me what to look into — a topic, a phrase in quotes, or a competitor's website — and I'll check this week's news, Reddit and their own site.",
    };
    yield { type: "done" };
    return;
  }

  yield { type: "step", step: { id: sid, agent: "strategy", label: `Deciding what this means for ${input.brand?.name || "your business"}`, status: "running" } };
  const brief = sources.map((s) => `[${s.n}] (${s.via}${s.publisher ? `, ${s.publisher}` : ""}${s.publishedAt ? `, ${new Date(s.publishedAt).toISOString().slice(0, 10)}` : ""}) ${s.title}`).join("\n");
  const res = await generateText({
    signal: deps.signal,
    cacheSalt: `research:${input.tenant}:${Date.now()}`,
    prompt: [
      `You are the strategist on ${input.brand?.name || "a small business"}'s marketing team.`,
      input.brand?.oneLiner ? `The business: ${input.brand.oneLiner}` : "",
      input.brand?.audience ? `Its customers: ${input.brand.audience}` : "",
      ``,
      `The founder asked: ${input.question}`,
      ``,
      `This is everything the research agent found this week. It is ALL you know:`,
      brief,
      ``,
      `Answer in 3 to 6 short sentences of plain prose.`,
      `- Say what is actually happening, then what it means for this business, then one concrete thing to do.`,
      `- Cite every factual claim with its number, like [2]. A claim you cannot cite does not go in.`,
      `- Never invent numbers, percentages, companies or quotes. Count only what is listed above.`,
      // Seen in a live run: a post about quick commerce in general said "20 million users in
      // eight minutes", and the answer credited the figure to Amazon because Amazon was in
      // another headline. The number was real; who it belonged to was invented.
      `- Attribute a figure only to who its own source says it belongs to. If a headline doesn't say whose number it is, don't name a company.`,
      `- You only have headlines, not articles. Don't claim more than a headline states.`,
      `- If the sources are thin or off-topic, say so plainly rather than stretching them.`,
      `- No headings, no bullet points, no preamble.`,
    ].filter(Boolean).join("\n"),
  });

  if (!res.ok) {
    yield { type: "step", step: { id: sid, agent: "strategy", label: "Deciding what this means for you", status: "failed", detail: "The writing model didn't answer — the sources above are still real" } };
    yield { type: "answer", text: "I found the sources above but couldn't write the summary just now. They're worth a read on their own; ask again in a minute and I'll pull it together." };
  } else {
    yield { type: "step", step: { id: sid, agent: "strategy", label: `Deciding what this means for ${input.brand?.name || "your business"}`, status: "done" } };
    yield { type: "answer", text: res.text.trim() };
  }
  yield { type: "done" };
}
