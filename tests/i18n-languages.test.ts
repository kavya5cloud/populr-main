import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LANGUAGE_CODES,
  DEFAULT_LANGUAGE,
  isLanguageCode,
  isEnglish,
  LANGUAGE_LABELS,
  getWorkspaceLanguage,
} from "@/lib/i18n/languages";

describe("i18n language preferences (Stage 1)", () => {
  it("defines LANGUAGE_CODES as the single source of truth", () => {
    expect(LANGUAGE_CODES).toBeDefined();
    expect(LANGUAGE_CODES.length).toBeGreaterThanOrEqual(12);
    expect(LANGUAGE_CODES).toContain("en-IN");
    expect(LANGUAGE_CODES).toContain("hi-IN");
    expect(DEFAULT_LANGUAGE).toBe("en-IN");
  });

  it("validates language codes using isLanguageCode", () => {
    expect(isLanguageCode("hi-IN")).toBe(true);
    expect(isLanguageCode("en-IN")).toBe(true);
    expect(isLanguageCode("ta-IN")).toBe(true);
    expect(isLanguageCode("invalid-code")).toBe(false);
    expect(isLanguageCode(null)).toBe(false);
    expect(isLanguageCode(undefined)).toBe(false);
  });

  it("provides human-readable labels for all language codes", () => {
    for (const code of LANGUAGE_CODES) {
      expect(LANGUAGE_LABELS[code]).toBeDefined();
      expect(typeof LANGUAGE_LABELS[code]).toBe("string");
    }
    expect(LANGUAGE_LABELS["hi-IN"]).toContain("Hindi");
  });

  it("identifies English fallback correctly", () => {
    expect(isEnglish("en-IN")).toBe(true);
    expect(isEnglish("hi-IN")).toBe(false);
  });

  it("reads workspace language preference safely", async () => {
    expect(await getWorkspaceLanguage(null, "tenant-1")).toBe("en-IN");
  });
});

describe("server-readable language storage (Stage 1)", () => {
  it("Profile type carries language in lib/store.ts", () => {
    const src = readFileSync(new URL("../lib/store.ts", import.meta.url), "utf8");
    expect(src).toContain("language?: LanguageCode");
    expect(src).toContain('import type { LanguageCode } from "@/lib/i18n/languages"');
  });

  it("getWorkspaceLanguage defaults to en-IN for null sql", async () => {
    const result = await getWorkspaceLanguage(null, "any-tenant");
    expect(result).toBe(DEFAULT_LANGUAGE);
  });

  it("getWorkspaceLanguage defaults to en-IN for empty tenant", async () => {
    const result = await getWorkspaceLanguage(null, "");
    expect(result).toBe(DEFAULT_LANGUAGE);
  });

  it("getWorkspaceLanguage uses isLanguageCode to reject invalid stored values", () => {
    // Invalid strings must not pass the guard
    expect(isLanguageCode("hindi")).toBe(false);
    expect(isLanguageCode("en")).toBe(false);
    expect(isLanguageCode("IN")).toBe(false);
    expect(isLanguageCode(42)).toBe(false);
    // Valid strings pass
    for (const code of LANGUAGE_CODES) {
      expect(isLanguageCode(code)).toBe(true);
    }
  });

  it("Composer.tsx reads language from saved state and persists on change", () => {
    const src = readFileSync(new URL("../app/studio/Composer.tsx", import.meta.url), "utf8");
    // Reads from loadState
    expect(src).toContain("saved.profile?.language");
    // Persists via saveState
    expect(src).toContain("saveState(updatedSaved)");
    // Sets profile.language on the saved state
    expect(src).toContain("language: nextLang");
  });

  it("no hardcoded language literals — only LANGUAGE_CODES is used", () => {
    // The constraint: nobody should type "hi-IN" as a literal in production code.
    // Test files are exempt. Check the key files:
    const composerSrc = readFileSync(new URL("../app/studio/Composer.tsx", import.meta.url), "utf8");
    const sourcesSrc = readFileSync(new URL("../lib/automation/sources.ts", import.meta.url), "utf8");
    const aiSrc = readFileSync(new URL("../lib/content/ai.ts", import.meta.url), "utf8");
    for (const [name, src] of [["Composer", composerSrc], ["sources", sourcesSrc], ["ai", aiSrc]] as const) {
      // No raw "hi-IN" literals (test files are allowed to have them)
      const hiLiterals = src.match(/"hi-IN"/g) ?? [];
      expect(hiLiterals.length, `${name} contains hardcoded "hi-IN"`).toBe(0);
    }
  });
});

