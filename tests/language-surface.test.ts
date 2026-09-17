import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { DEFAULT_LANGUAGE, LANGUAGE_CODES, isLanguageCode, languageCode, localeLabel } from "@/lib/i18n/languages";

// The UI's whole job is to pick a LanguageCode. Everything downstream — which provider is
// preferred, how the prompt is built, how quality is graded — is decided by the application
// layer, and the Composer knows none of it. These tests hold that line as much as they test
// the plumbing.

/**
 * Source with comments removed.
 *
 * Twice now a check for "this string must not appear" has been tripped by the comment
 * explaining why it must not appear. Prose is not code, and a test that cannot tell them
 * apart forces you to weaken the assertion instead of fixing the test.
 */
const code = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

const composer = code("app/studio/Composer.tsx");
const route = code("app/api/content/compose/route.ts");

describe("the selector offers exactly what we support", () => {
  it("reads the options from the shared source, not a second list", () => {
    expect(composer).toContain("LANGUAGE_CODES.map");
    // A hardcoded list in the UI is the thing that silently diverges.
    expect(composer).not.toMatch(/"hi-IN"\s*,\s*"mr-IN"/);
  });

  it("defaults to the shared constant rather than a literal", () => {
    // The default moved to a prop default when Studio needed to seed a language. Assert the
    // invariant — the constant is the source, and no "en-IN" is written by hand — rather
    // than the exact expression, which is what made this test brittle the first time.
    expect(composer).toContain("initialLanguage = DEFAULT_LANGUAGE");
    expect(composer).toContain("useState<LanguageCode>(initialLanguage)");
    expect(composer).not.toContain('"en-IN"');
    expect(DEFAULT_LANGUAGE).toBe("en-IN");
  });

  it("offers every language the infrastructure supports", () => {
    // The eleven from the brief: English plus ten Indian languages.
    for (const code of ["en-IN", "hi-IN", "bn-IN", "gu-IN", "kn-IN", "ml-IN", "mr-IN", "pa-IN", "ta-IN", "te-IN"]) {
      expect(LANGUAGE_CODES, code).toContain(code);
    }
  });

  it("labels each one so a person can read it", () => {
    expect(localeLabel("en-IN")).toBe("English");
    expect(localeLabel("hi-IN")).toBe("Hindi (हिन्दी)");
    for (const c of LANGUAGE_CODES) expect(localeLabel(c).length, c).toBeGreaterThan(2);
  });
});

describe("the UI knows nothing about providers", () => {
  it("never mentions Sarvam, a model or a provider preference", () => {
    for (const leak of ["sarvam", "Sarvam", "preferProvider", "SARVAM_API_KEY", "105b"]) {
      expect(composer, leak).not.toContain(leak);
    }
  });

  it("does not call the translation capability", () => {
    // New content is generated natively. Translation is for content that already exists.
    expect(composer).not.toContain("localize(");
  });

  it("sends only the code over the wire", () => {
    expect(composer).toContain("language, ...body");
  });
});

describe("the API boundary validates before it trusts", () => {
  it("falls back to English rather than rejecting an unknown code", () => {
    expect(route).toContain("isLanguageCode(body.language) ? body.language : DEFAULT_LANGUAGE");
  });

  it("accepts every supported code and refuses anything else", () => {
    for (const c of LANGUAGE_CODES) expect(isLanguageCode(c), c).toBe(true);
    for (const bad of ["", "en", "hi", "xx-XX", "fr-FR", null, undefined, 42, {}]) {
      expect(isLanguageCode(bad), String(bad)).toBe(false);
    }
  });

  it("coerces anything unrecognised to English rather than throwing", () => {
    expect(languageCode("xx-XX")).toBe("en-IN");
    expect(languageCode(undefined)).toBe("en-IN");
    expect(languageCode(null)).toBe("en-IN");
  });
});

// ── The behaviour that actually matters: what reaches the model ────────────
const KEYS = ["GEMINI_API_KEY", "GROQ_API_KEY", "OPENAI_API_KEY", "SARVAM_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};

const chatOk = () => new Response(
  JSON.stringify({ choices: [{ message: { content: JSON.stringify({ title: "t", body: "एक\n\nदो\n\nतीन" }) }, finish_reason: "stop" }] }),
  { status: 200, headers: { "Content-Type": "application/json" } });

describe("language reaches the model as a native-generation instruction", () => {
  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k];
    for (const k of KEYS) process.env[k] = k === "SARVAM_API_KEY" ? "sarvam-key" : "";
    process.env.GROQ_API_KEY = "gsk_groq";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });

  const runCompose = async (language?: string) => {
    const seen: { url: string; body: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(u), body: String(init?.body ?? "") });
      return chatOk();
    }));
    const { composeWithAi } = await import("@/lib/content/ai");
    await composeWithAi({
      tenant: "t", prompt: "new collection", format: "post", audience: "shoppers",
      platforms: [], now: Date.UTC(2026, 7, 30),
      ...(language ? { language: language as never } : {}),
    });
    return seen;
  };

  it("asks for native writing, not translation, when Hindi is selected", async () => {
    const seen = await runCompose("hi-IN");
    const prompt = seen.map((s) => s.body).join(" ");
    expect(prompt).toContain("WRITE IN");
    expect(prompt).toContain("Hindi");
    expect(prompt).toMatch(/natively, not translated/);
    // The failure this guards: asking a chat model to translate rather than to write.
    expect(prompt).not.toMatch(/translate this into/i);
  });

  it("never calls the translation endpoint for new content", async () => {
    const seen = await runCompose("hi-IN");
    expect(seen.some((s) => s.url.includes("/translate"))).toBe(false);
  });

  it("prefers Sarvam for Hindi", async () => {
    const seen = await runCompose("hi-IN");
    expect(seen[0].url).toContain("api.sarvam.ai");
  });

  it("does NOT prefer Sarvam for English", async () => {
    const seen = await runCompose("en-IN");
    expect(seen[0].url).not.toContain("api.sarvam.ai");
    expect(seen[0].url).toContain("groq");
  });

  it("behaves identically when no language is passed at all", async () => {
    const withNone = await runCompose();
    const withEnglish = await runCompose("en-IN");
    expect(withNone[0].url).toBe(withEnglish[0].url);
    // Byte-identical prompts: the language block is a spread that yields nothing for English.
    expect(withNone[0].body).toBe(withEnglish[0].body);
  });

  it("adds no language instruction to an English prompt", async () => {
    const seen = await runCompose("en-IN");
    expect(seen[0].body).not.toContain("WRITE IN");
  });

  it("keeps English and Hindi in separate cache identities", async () => {
    const en = await runCompose("en-IN");
    const hi = await runCompose("hi-IN");
    expect(en[0].body).not.toBe(hi[0].body);
  });

  it("still falls back when the preferred provider fails", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL) => {
      const url = String(u);
      seen.push(url);
      if (url.includes("sarvam")) return new Response("forbidden", { status: 403 });
      return chatOk();
    }));
    const { composeWithAi } = await import("@/lib/content/ai");
    const r = await composeWithAi({
      tenant: "t", prompt: "x", format: "post", audience: "a",
      platforms: [], now: Date.UTC(2026, 7, 30), language: "hi-IN",
    });
    expect(seen.some((u) => u.includes("groq"))).toBe(true);
    expect(r.source).toBe("llm");
  });
});
