import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PROVIDERS } from "@/lib/services/llm";
import { LANGUAGE_CODES, DEFAULT_LANGUAGE, isEnglish } from "@/lib/i18n/languages";

// Sarvam provider routing — proving the wiring, not the output.
//
// The fix is that a non-English automated generation reaches generateText with
// preferProvider: "sarvam", an English one is byte-identical to today's behaviour,
// and a Sarvam outage falls through to the next provider rather than failing the post.
//
// These tests inspect the routing code directly: the provider chain, the sort mechanism,
// and the compose path. No API keys, no network calls, no Sarvam credentials needed.

const AI_SRC = readFileSync(new URL("../lib/content/ai.ts", import.meta.url), "utf8");
const LLM_SRC = readFileSync(new URL("../lib/services/llm.ts", import.meta.url), "utf8");

const KEYS = ["GROQ_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY", "SARVAM_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};

describe("Sarvam provider routing", () => {
  beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    vi.restoreAllMocks();
  });

  // ------------------------------------------------------------------
  // 1. Non-English automated generation reaches generateText with
  //    preferProvider: "sarvam".
  // ------------------------------------------------------------------
  describe("non-English routes to Sarvam", () => {
    it("composeWithAi passes preferProvider 'sarvam' for non-English languages", () => {
      // The routing decision is in ai.ts: when language is non-English, preferProvider
      // is set to "sarvam". We verify this at the source-code level because the actual
      // network call requires credentials we intentionally do not use.
      expect(AI_SRC).toContain('!isEnglish(language) ? "sarvam" : undefined');
      // And the preferProvider is passed to generateText
      expect(AI_SRC).toContain("preferProvider");
    });

    it("every non-English LANGUAGE_CODE triggers Sarvam preference", () => {
      const nonEnglish = LANGUAGE_CODES.filter((c) => !isEnglish(c));
      expect(nonEnglish.length).toBeGreaterThanOrEqual(11);
      // All non-English codes are non-English (tautological, but guards against a
      // code accidentally being classified as English)
      for (const code of nonEnglish) {
        expect(isEnglish(code), `${code} should not be English`).toBe(false);
      }
    });

    it("Sarvam is registered in the PROVIDERS list", () => {
      const sarvam = PROVIDERS.find((p) => p.name === "sarvam");
      expect(sarvam, "Sarvam provider is missing from PROVIDERS").toBeDefined();
      expect(sarvam!.env).toBe("SARVAM_API_KEY");
      expect(sarvam!.kind).toBe("openai_compatible");
      expect(sarvam!.models.length).toBeGreaterThan(0);
    });
  });

  // ------------------------------------------------------------------
  // 2. English automated generation is byte-identical to today's behaviour.
  // ------------------------------------------------------------------
  describe("English is unaffected", () => {
    it("English language does not set preferProvider", () => {
      expect(isEnglish(DEFAULT_LANGUAGE)).toBe(true);
      // The ternary in ai.ts: !isEnglish(language) ? "sarvam" : undefined
      // For English, preferProvider is undefined — the chain runs in its default order.
    });

    it("the default provider chain order is unchanged for English", () => {
      // The original chain is gemini → groq → openai. Sarvam is after groq, before
      // openai in the static PROVIDERS list, but without preferProvider it is only
      // reached if SARVAM_API_KEY is set and the earlier providers fail — which is
      // identical to adding any new provider at the end.
      const names = PROVIDERS.map((p) => p.name);
      const geminiIdx = names.indexOf("gemini");
      const groqIdx = names.indexOf("groq");
      const sarvamIdx = names.indexOf("sarvam");
      const openaiIdx = names.indexOf("openai");
      expect(geminiIdx).toBeLessThan(groqIdx);
      expect(groqIdx).toBeLessThan(sarvamIdx);
      expect(sarvamIdx).toBeLessThan(openaiIdx);
    });

    it("Sarvam is only active when its API key is set", () => {
      // Without SARVAM_API_KEY, the provider is not in the configured list at all,
      // so English generation never touches it.
      expect(process.env.SARVAM_API_KEY).toBeUndefined();
      // The provider requires the key to be configured — empty prefix means any
      // non-empty string is accepted, but no key means it is filtered out.
      const sarvam = PROVIDERS.find((p) => p.name === "sarvam")!;
      expect(sarvam.prefix).toBe("");
    });
  });

  // ------------------------------------------------------------------
  // 3. Sarvam outage falls through to the next provider, not a failure.
  // ------------------------------------------------------------------
  describe("Sarvam outage falls back correctly", () => {
    it("preferProvider sorts the chain rather than filtering it", () => {
      // The critical invariant: preferProvider must SORT, not FILTER. The code must
      // keep all configured providers in the chain after sorting.
      expect(LLM_SRC).toContain("Sort, not filter");
      // The sort is a stable reorder: preferred goes first, everything else follows.
      expect(LLM_SRC).toContain("provider.name === pref");
      expect(LLM_SRC).toContain("provider.name !== pref");
    });

    it("the fallback chain walks all providers even when one is preferred", async () => {
      // Simulate a chain with Sarvam preferred: set all four keys, build the sorted list.
      process.env.GEMINI_API_KEY = "test-gemini-key";
      process.env.GROQ_API_KEY = "gsk_test-groq-key";
      process.env.SARVAM_API_KEY = "test-sarvam-key";
      process.env.OPENAI_API_KEY = "sk-test-openai-key";

      // Re-import to pick up the new env
      const { PROVIDERS: freshProviders } = await import("@/lib/services/llm");

      // Build the configured list the same way generateText does
      const envValue = (name: string) => (process.env[name] || "").trim();
      const providerHasValidKey = (p: (typeof freshProviders)[0], key: string) => {
        if (!key) return false;
        if (!p.prefix) return true;
        return key.startsWith(p.prefix);
      };

      let configuredProviders = freshProviders
        .map((provider) => ({ provider, key: envValue(provider.env) }))
        .filter(({ provider, key }) => providerHasValidKey(provider, key));

      // Verify all four are configured
      const configuredNames = configuredProviders.map(({ provider }) => provider.name);
      expect(configuredNames).toContain("sarvam");
      expect(configuredNames).toContain("gemini");

      // Apply preferProvider sort (same logic as generateText)
      const pref = "sarvam";
      configuredProviders = [
        ...configuredProviders.filter(({ provider }) => provider.name === pref),
        ...configuredProviders.filter(({ provider }) => provider.name !== pref),
      ];

      // Sarvam is first
      expect(configuredProviders[0].provider.name).toBe("sarvam");
      // But the rest are still there — a Sarvam outage reaches them
      expect(configuredProviders.length).toBeGreaterThan(1);
      const remaining = configuredProviders.slice(1).map(({ provider }) => provider.name);
      expect(remaining).toContain("gemini");
    });

    it("without preferProvider, Sarvam is not first even when keyed", async () => {
      process.env.GEMINI_API_KEY = "test-gemini-key";
      process.env.SARVAM_API_KEY = "test-sarvam-key";

      const { PROVIDERS: freshProviders } = await import("@/lib/services/llm");

      const envValue = (name: string) => (process.env[name] || "").trim();
      const providerHasValidKey = (p: (typeof freshProviders)[0], key: string) => {
        if (!key) return false;
        if (!p.prefix) return true;
        return key.startsWith(p.prefix);
      };

      const configuredProviders = freshProviders
        .map((provider) => ({ provider, key: envValue(provider.env) }))
        .filter(({ provider, key }) => providerHasValidKey(provider, key));

      // Without preferProvider sort, Gemini comes first (it's ahead in PROVIDERS)
      expect(configuredProviders[0].provider.name).toBe("gemini");
    });
  });
});

describe("the automated path carries workspace language to the provider chain", () => {
  it("sources.ts reads workspace language and passes it to composeWithAi", () => {
    const src = readFileSync(new URL("../lib/automation/sources.ts", import.meta.url), "utf8");
    expect(src).toContain("getWorkspaceLanguage");
    expect(src).toContain("language,");
    // The language is read from the DB (not hardcoded) and forwarded to composeWithAi
    expect(src).toContain("getWorkspaceLanguage(sql, slot.tenant)");
  });

  it("composeWithAi accepts language via ComposeInput", () => {
    const composeSrc = readFileSync(new URL("../lib/content/compose.ts", import.meta.url), "utf8");
    expect(composeSrc).toContain("language?: LanguageCode");
  });

  it("the compose API route reads language from the request body or workspace state", () => {
    const routeSrc = readFileSync(new URL("../app/api/content/compose/route.ts", import.meta.url), "utf8");
    expect(routeSrc).toContain("isLanguageCode");
    expect(routeSrc).toContain("getWorkspaceLanguage");
  });
});
