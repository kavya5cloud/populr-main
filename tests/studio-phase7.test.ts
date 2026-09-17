import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { STUDIO_KINDS } from "@/lib/studio/kinds";
import { LANGUAGE_CODES, DEFAULT_LANGUAGE, isEnglish, localeLabel } from "@/lib/i18n/languages";
import { scoreDraft } from "@/lib/content/craft";
import { localeCraft } from "@/lib/content/craft-locale";
import { CONTENT_FORMATS } from "@/lib/content/compose";

// Phase 7: prove each of the eight cards and each of the eleven languages actually reaches
// the pipeline and produces something the pipeline supports — rather than trusting that the
// wiring written in Phase 2 does what it says.

const KEYS = ["GEMINI_API_KEY", "GROQ_API_KEY", "OPENAI_API_KEY", "SARVAM_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};

const modelReply = (body: string) => new Response(
  JSON.stringify({ choices: [{ message: { content: JSON.stringify({ title: "t", body }) }, finish_reason: "stop" }] }),
  { status: 200, headers: { "Content-Type": "application/json" } });

/** Runs a real compose and reports which host was called and what prompt was sent. */
async function compose(over: Record<string, unknown>) {
  const calls: { url: string; body: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(u), body: String(init?.body ?? "") });
    return modelReply("पहली पंक्ति।\n\n- एक\n- दो\n\nदेखिए।");
  }));
  const { composeWithAi } = await import("@/lib/content/ai");
  const result = await composeWithAi({
    tenant: "t", prompt: "x", format: "post", audience: "a",
    platforms: [], now: Date.UTC(2026, 7, 30), ...over,
  } as Parameters<typeof composeWithAi>[0]);
  return { calls, result };
}

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  for (const k of KEYS) process.env[k] = "";
  process.env.SARVAM_API_KEY = "sarvam-key";
  process.env.GROQ_API_KEY = "gsk_groq";
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe("all 8 cards reach the real pipeline", () => {
  for (const kind of STUDIO_KINDS) {
    it(`${kind.id}: seeds a prompt and composes through the supported path`, async () => {
      // Every card's format must be one the composer genuinely handles.
      expect(CONTENT_FORMATS as readonly string[], kind.id).toContain(kind.format);
      expect(kind.seed.trim().length).toBeGreaterThan(10);

      const { calls, result } = await compose({
        prompt: kind.seed, format: kind.format,
        ...(kind.language ? { language: kind.language } : {}),
      });

      // A real model call happened — no card has fake generation behind it.
      expect(calls.length, kind.id).toBeGreaterThan(0);
      expect(calls[0].body).toContain("THE ASK");
      expect(result.source, kind.id).toBe("llm");
      // And nothing reached a translation endpoint.
      expect(calls.some((c) => c.url.includes("/translate")), kind.id).toBe(false);
    });
  }

  it("only the multilingual card presets a language", () => {
    expect(STUDIO_KINDS.filter((k) => k.language).map((k) => k.id)).toEqual(["multilingual"]);
  });
});

describe("all 11 languages behave correctly end to end", () => {
  it("has exactly the eleven we support", () => {
    expect(LANGUAGE_CODES).toHaveLength(11);
    for (const c of LANGUAGE_CODES) expect(localeLabel(c).length, c).toBeGreaterThan(2);
  });

  for (const code of LANGUAGE_CODES.filter((c) => !isEnglish(c))) {
    it(`${code}: native instruction, Sarvam preferred, own cache identity`, async () => {
      const { calls } = await compose({ language: code });
      const prompt = calls[0].body;
      expect(prompt, code).toContain("WRITE IN");
      expect(prompt, code).toMatch(/natively, not translated/);
      // Sarvam is preferred for Indian-language work — and only preferred, see below.
      expect(calls[0].url, code).toContain("api.sarvam.ai");
      // The salt carries the language, so no two languages share a cache entry.
      const other = await compose({ language: "en-IN" });
      expect(prompt).not.toBe(other.calls[0].body);
    });
  }

  it("English is unchanged: no language block, no Sarvam preference", async () => {
    const { calls } = await compose({ language: DEFAULT_LANGUAGE });
    expect(calls[0].body).not.toContain("WRITE IN");
    expect(calls[0].url).toContain("groq");
    expect(calls[0].url).not.toContain("sarvam");
  });

  it("omitting language behaves exactly like English", async () => {
    const none = await compose({});
    const english = await compose({ language: DEFAULT_LANGUAGE });
    expect(none.calls[0].body).toBe(english.calls[0].body);
    expect(none.calls[0].url).toBe(english.calls[0].url);
  });

  it("preference is a preference: Sarvam failing still yields a post", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL) => {
      const url = String(u);
      calls.push(url);
      if (url.includes("sarvam")) return new Response("forbidden", { status: 403 });
      return modelReply("एक।\n\n- दो\n\nतीन।");
    }));
    const { composeWithAi } = await import("@/lib/content/ai");
    const r = await composeWithAi({
      tenant: "t", prompt: "x", format: "post", audience: "a",
      platforms: [], now: Date.UTC(2026, 7, 30), language: "hi-IN",
    });
    expect(calls.some((u) => u.includes("groq"))).toBe(true);
    expect(r.source).toBe("llm");
  });
});

describe("the quality gate really evaluates Hindi", () => {
  const url = "https://acme.in/sale";
  const hindiWall = Array.from({ length: 9 },
    (_, i) => `यह एक काफ़ी लंबा वाक्य है जिसमें कई शब्द हैं और यह क्रमांक ${i} पर आता है।`).join(" ");

  it("splits on the danda, so sentence-based checks actually run", () => {
    const sents = localeCraft("hi-IN").splitSentences(hindiWall);
    expect(sents.length).toBe(9);
    // The bug this replaced: the English splitter saw one sentence and every check switched off.
    expect(hindiWall.split(/(?<=[.!?])\s+/)).toHaveLength(1);
  });

  it("flags a Hindi wall rather than passing it", () => {
    const r = scoreDraft(hindiWall, "hi-IN");
    expect(r.issues.some((i) => i.code === "monotone_shape")).toBe(true);
    expect(r.needsRewrite).toBe(true);
  });

  it("passes well-shaped Hindi with paragraphs, a CTA, a URL and hashtags", () => {
    const good = [
      "नया कलेक्शन आ गया है।",
      "",
      "- हाथ से बुना",
      "- सीमित स्टॉक",
      "",
      `आज ही देखिए: ${url}`,
      "",
      "#जयपुर #हैंडलूम",
    ].join("\n");
    const r = scoreDraft(good, "hi-IN");
    expect(r.issues.some((i) => i.code === "monotone_shape")).toBe(false);
    expect(r.needsRewrite).toBe(false);
  });

  it("does not invent English faults in Hindi text", () => {
    const r = scoreDraft("इन दिनों हर ब्रांड ऑनलाइन है। हमने कुछ अलग किया।", "hi-IN");
    for (const code of ["ai_tell", "vague_claim", "weak_opening", "summary_ending"]) {
      expect(r.issues.some((i) => i.code === code), code).toBe(false);
    }
  });

  it("does the same for a second Indic language — Tamil", () => {
    const tamilWall = Array.from({ length: 8 },
      (_, i) => `இது ஒரு நீண்ட வாக்கியம் மற்றும் இது எண் ${i} ஆகும்.`).join(" ");
    expect(localeCraft("ta-IN").splitSentences(tamilWall).length).toBe(8);
    expect(scoreDraft(tamilWall, "ta-IN").issues.some((i) => i.code === "monotone_shape")).toBe(true);

    const good = "புதிய தொகுப்பு வந்துவிட்டது.\n\n- கையால் நெய்யப்பட்டது\n- குறைந்த இருப்பு\n\nபாருங்கள்.";
    expect(scoreDraft(good, "ta-IN").issues.some((i) => i.code === "monotone_shape")).toBe(false);
  });

  it("still catches English faults in English", () => {
    const bad = "In today's fast-paced world, studies show we've got you covered. In conclusion, leverage synergy.";
    const r = scoreDraft(bad);
    expect(r.issues.some((i) => i.code === "ai_tell")).toBe(true);
    expect(r.issues.some((i) => i.code === "vague_claim")).toBe(true);
  });
});
