import { terms as contentWords } from "@/lib/market/util";

// The pure half of live research: deciding whether a chat message is a market question, and
// what to search for. No server imports, so the chat page can call it to choose the streaming
// path without pulling the provider layer into the browser bundle.

export type ResearchBrand = { name?: string; oneLiner?: string; audience?: string; competitors?: string[] };

/** Market questions, as opposed to requests to write something. Deterministic, no model. */
// "this week" and "latest" used to count on their own, which sent "What should I post on
// LinkedIn this week?" to market research — it searched the news for "linkedin grocery" and
// came back with a court case and an RBI rule. A time phrase isn't a market question; a
// market word is.
const RESEARCH_RE = /\b(trend(s|ing)?|news|what'?s (happening|new|going on)|what is (happening|new|going on)|market|competitors?|competition|rivals?|reddit|people (are )?(saying|talking)|buzz|industry)\b/i;
/** Asking for advice is a question for the CMO, not a search, even with a market word in it. */
const ADVICE_RE = /\b(should (i|we)|what (do|should|can) (i|we) (post|write|do|say)|how (do|should|can) (i|we))\b/i;
const WRITE_RE = /\b(write|draft|create|generate|compose|make me|give me (a|an|some) (post|thread|caption|email|blog))\b/i;

export function isResearchQuestion(text: string): boolean {
  const t = (text || "").trim();
  return t.length > 0 && RESEARCH_RE.test(t) && !WRITE_RE.test(t) && !ADVICE_RE.test(t);
}

/**
 * What to search for. A quoted phrase in the question wins; otherwise the question's own
 * content words, falling back to what the business does. Generic words ("trend", "market")
 * are dropped — searching for "market" finds the stock market.
 */
const GENERIC = new Set([
  "trend", "trends", "trending", "news", "market", "markets", "competitor", "competitors", "competition",
  "reddit", "happening", "going", "latest", "week", "weeks", "today", "month", "industry", "people", "saying",
  "talking", "buzz", "rivals", "doing", "about", "any", "anything", "there", "right", "now", "currently",
  "tell", "know", "think", "around", "space", "sector", "lately", "recently",
]);

// Contractions are dropped outright: "what's" survived the stop list (which has "what"),
// and "What's trending in quick commerce?" searched for "what's quick".
const meaningful = (w: string) => !w.includes("'") && !GENERIC.has(w);

export function searchTermsFor(question: string, brand?: ResearchBrand): string[] {
  const quoted = [...question.matchAll(/"([^"]{2,60})"/g)].map((m) => m[1].trim());
  if (quoted.length) return quoted.slice(0, 3);
  const words = contentWords(question).filter(meaningful);
  if (words.length >= 2) return [words.slice(0, 2).join(" "), ...words.slice(2, 3)];
  if (words.length === 1) return words;
  const fallback = contentWords(brand?.oneLiner ?? "").filter(meaningful).slice(0, 2).join(" ");
  return fallback ? [fallback] : [];
}

/** Competitors worth fetching: those given as a site, from the question or the profile. */
export function competitorSites(question: string, brand?: ResearchBrand): string[] {
  const inQuestion = [...question.matchAll(/\b((?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/gi)].map((m) => m[1]);
  return [...new Set([...inQuestion, ...(brand?.competitors ?? [])])].slice(0, 4);
}

