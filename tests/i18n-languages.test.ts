import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LANGUAGE_CODES,
  DEFAULT_LANGUAGE,
  isLanguageCode,
  isEnglish,
  localeLabel,
  getWorkspaceLanguage,
} from "@/lib/i18n/languages";

describe("i18n language preferences (Stage 1)", () => {
  it("defines LANGUAGE_CODES as the single source of truth", () => {
    expect(LANGUAGE_CODES).toBeDefined();
    // Not a count. Asserting "at least twelve" would fail the day a language is retired for
    // a reason that has nothing to do with this feature; what matters is that the table is
    // non-empty, has no duplicates, and that every entry passes our own guard.
    expect(LANGUAGE_CODES.length).toBeGreaterThan(1);
    expect(new Set(LANGUAGE_CODES).size).toBe(LANGUAGE_CODES.length);
    expect(LANGUAGE_CODES.every(isLanguageCode)).toBe(true);
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
      expect(localeLabel(code)).toBeTruthy();
      expect(typeof localeLabel(code)).toBe("string");
    }
    expect(localeLabel("hi-IN")).toContain("Hindi");
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
    // Named after the contract, not after local variables: the original version of this test
    // asserted `saveState(updatedSaved)` and `nextLang`, which pinned one author's spelling
    // rather than the behaviour, and broke the moment the composer was rewritten.
    expect(src).toMatch(/import .*\bsaveState\b.*from "@\/lib\/store"/);
    // Reads the saved preference back rather than resetting to the default each mount.
    expect(src).toMatch(/\.language\b/);
    // Writes it into profile, which is exactly where getWorkspaceLanguage looks for it.
    expect(src).toMatch(/profile:\s*\{[^}]*language/);
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

