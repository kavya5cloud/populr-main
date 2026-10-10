import { generateText } from "@/lib/services/llm";
import { IDENTITY_RULES, QUALITY_RULES } from "@/lib/cmo/quality-rules";
import { scrubIdentity } from "@/lib/cmo/identity";
import { isResearchQuestion } from "@/lib/agents/live/intent";
import { runResearch } from "@/lib/agents/live/research";
import type { SignalAggregator } from "@/lib/market/aggregator";

// What the CMO says out loud.
//
// A spoken answer is a different shape from a written one: no lists, no headings, no
// "[2]", and short enough that nobody waits through it. The rules are the same ones chat
// follows — never invent a figure, never name the model behind it — imported, not
// restated, so voice can't quietly drift into saying what chat may not.
//
// Market questions go to the live research agents exactly as they do in chat; the spoken
// reply is their answer with the citation markers taken out, and the sources travel with it
// so the call screen can show them.

export type VoiceTurn = { role: "founder" | "cmo"; text: string };
export type VoiceBrand = { name?: string; oneLiner?: string; audience?: string; competitors?: string[] };
export type VoiceAnswer = { reply: string; sources: { n: number; title: string; url: string }[] };

const LANGUAGE_NAME: Record<string, string> = {
  "en-IN": "English", "hi-IN": "Hindi", "bn-IN": "Bengali", "ta-IN": "Tamil", "te-IN": "Telugu", "kn-IN": "Kannada",
  "ml-IN": "Malayalam", "mr-IN": "Marathi", "gu-IN": "Gujarati", "pa-IN": "Punjabi", "od-IN": "Odia",
};

/** Text made for reading, turned into text made for hearing. */
export function forSpeech(text: string): string {
  return text
    .replace(/\[\d+\](\[\d+\])*/g, "")          // citation markers
    .replace(/[*_#>`]/g, "")                     // markdown
    .replace(/^\s*[-•]\s+/gm, "")                // bullets
    .replace(/https?:\/\/\S+/g, "")              // links are for the screen
    .replace(/\s+/g, " ")                        // line breaks too: they'd be read mid-sentence
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

export async function voiceAnswer(
  input: { tenant: string; question: string; language: string; history: VoiceTurn[]; brand: VoiceBrand },
  deps: { aggregator: SignalAggregator; signal?: AbortSignal },
): Promise<VoiceAnswer> {
  if (isResearchQuestion(input.question)) {
    let answer = "", sources: VoiceAnswer["sources"] = [];
    for await (const e of runResearch({ tenant: input.tenant, question: input.question, brand: input.brand }, deps)) {
      if (e.type === "answer") answer = e.text;
      if (e.type === "sources") sources = e.sources.map((s) => ({ n: s.n, title: s.title, url: s.url }));
    }
    const spoken = forSpeech(answer);
    return { reply: sources.length ? `${spoken} I've put the sources on your screen.` : spoken, sources };
  }

  const lang = LANGUAGE_NAME[input.language] ?? "English";
  const history = input.history.slice(-8).map((t) => `${t.role === "founder" ? "Founder" : "You"}: ${t.text}`).join("\n");
  const res = await generateText({
    signal: deps.signal,
    cacheSalt: `voice:${input.tenant}:${Date.now()}`,
    prompt: [
      `You are on a voice call with the founder of ${input.brand.name || "a small business"}, as their CMO.`,
      input.brand.oneLiner ? `The business: ${input.brand.oneLiner}` : "",
      input.brand.audience ? `Its customers: ${input.brand.audience}` : "",
      ``,
      IDENTITY_RULES,
      QUALITY_RULES,
      ``,
      `This is spoken aloud, so:`,
      `- Answer in ${lang}, the language the founder just spoke.`,
      `- Two to four short sentences. Say the one thing that matters most first.`,
      `- No lists, headings, symbols, links or markdown — they get read out literally.`,
      `- If you need something to answer well, ask one short question back.`,
      history ? `\nThe call so far:\n${history}` : "",
      ``,
      `Founder: ${input.question}`,
    ].filter(Boolean).join("\n"),
  });
  const reply = res.ok ? forSpeech(scrubIdentity(res.text).text) : "Sorry, I lost my train of thought for a second. Could you say that again?";
  return { reply: reply.slice(0, 900), sources: [] };
}
