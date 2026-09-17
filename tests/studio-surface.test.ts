import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { STUDIO_KINDS, studioKind } from "@/lib/studio/kinds";
import { LANGUAGE_CODES, isLanguageCode } from "@/lib/i18n/languages";
import { CONTENT_FORMATS } from "@/lib/content/compose";

// Studio is a presentation layer. It owns no generation, no provider knowledge, and no
// second copy of the language list — and it may only advertise what the pipeline can
// actually produce today.

const studio = readFileSync("app/studio/create/Studio.tsx", "utf8");
const card = readFileSync("app/studio/create/CreationCard.tsx", "utf8");
const kinds = readFileSync("lib/studio/kinds.ts", "utf8");

describe("it only offers what Populr can deliver", () => {
  it("has the eight agreed kinds", () => {
    expect(STUDIO_KINDS).toHaveLength(8);
    expect(STUDIO_KINDS.map((k) => k.id).sort()).toEqual(
      ["ad", "article", "email", "launch", "multilingual", "script", "seo", "social"],
    );
  });

  it("promises no media file in anything a user reads", () => {
    // Nothing in this codebase renders one — mediaUri() returns a synthetic locator, and a
    // card offering a clip is the failure that got the video path pulled off the marketing
    // site. Checked against the copy rather than the source: the comment in kinds.ts
    // explaining why these are absent would otherwise trip a raw-text scan.
    const copy = STUDIO_KINDS.map((k) => `${k.title} ${k.blurb}`).join(" ").toLowerCase();
    for (const banned of ["short video", "voice content", "waveform", "audio", "clip", "render"]) {
      expect(copy, banned).not.toContain(banned);
    }
  });

  it("draws no preview that implies a media file", () => {
    const previews = STUDIO_KINDS.map((k) => k.preview);
    for (const banned of ["video", "voice", "audio", "waveform"]) {
      expect(previews as string[], banned).not.toContain(banned);
    }
  });

  it("offers a script rather than a clip, which is a real deliverable", () => {
    const s = studioKind("script")!;
    expect(s.title).toMatch(/script/i);
    expect(s.blurb).toMatch(/you bring the camera/i);
  });

  it("gives every kind a real composer format", () => {
    for (const k of STUDIO_KINDS) {
      // Against the real list, not a copy of it: the invariant is "a format the composer
      // knows", and a frozen literal here just breaks whenever a format is added.
      expect(CONTENT_FORMATS as readonly string[], k.id).toContain(k.format);
      expect(k.seed.length, k.id).toBeGreaterThan(10);
    }
  });
});

describe("the prompt is the product; cards are shortcuts", () => {
  it("fills the box rather than generating", () => {
    // A card that silently started a generation would take the decision away from the person.
    expect(card).toContain("Fills the prompt so you can edit it");
    expect(card).not.toContain("fetch(");
  });

  it("seeds the composer rather than reimplementing it", () => {
    expect(studio).toContain("initialPrompt");
    expect(studio).toContain("<Composer");
    // No generation, no result rendering, no publish logic of its own.
    expect(studio).not.toContain("/api/content/compose");
  });
});

describe("Studio knows nothing about providers", () => {
  it("never names a vendor or a model", () => {
    for (const leak of ["sarvam", "Sarvam", "preferProvider", "gemini", "groq", "openai", "105b"]) {
      expect(`${studio} ${card} ${kinds}`, leak).not.toContain(leak);
    }
  });
});

describe("one language list, not two", () => {
  it("uses the shared language module", () => {
    expect(studio).toContain('from "@/lib/i18n/languages"');
    // No inline list of codes anywhere in Studio.
    expect(studio).not.toMatch(/"hi-IN"\s*,\s*"mr-IN"/);
    expect(kinds).not.toMatch(/"hi-IN"\s*,\s*"mr-IN"/);
  });

  it("uses a real code for the multilingual card", () => {
    const m = studioKind("multilingual")!;
    expect(isLanguageCode(m.language)).toBe(true);
    expect(LANGUAGE_CODES).toContain(m.language);
  });

  it("presets a language on that card only", () => {
    const withLanguage = STUDIO_KINDS.filter((k) => k.language);
    expect(withLanguage.map((k) => k.id)).toEqual(["multilingual"]);
  });

  it("includes Odia, verified against Sarvam's documented enum", () => {
    expect(LANGUAGE_CODES).toContain("od-IN");
    expect(LANGUAGE_CODES).toHaveLength(11);
  });
});

describe("previews are drawn, not fetched", () => {
  it("uses no images or third-party assets", () => {
    for (const banned of ["<img", "background-image", "http://", "https://", ".png", ".jpg", ".svg"]) {
      expect(card, banned).not.toContain(banned);
    }
  });
});
