import { describe, expect, it } from "vitest";
import { scoreDraft } from "@/lib/content/craft";
import { localeCraft } from "@/lib/content/craft-locale";
import { sentenceSplitter, LANGUAGE_CODES } from "@/lib/i18n/languages";

// The bug this exists to prevent: scoreDraft is the gate that decides whether a draft ships,
// and it was written for English. Run Hindi through it unchanged and it does not misfire —
// it silently passes, because none of the English patterns match and the sentence splitter
// finds no "." so the whole post counts as one sentence. A gate that quietly stops gating is
// worse than no gate.

describe("sentences are split by the language's own terminator", () => {
  it("splits Hindi on the danda", () => {
    const hindi = "यह पहला वाक्य है। यह दूसरा वाक्य है। यह तीसरा है।";
    expect(localeCraft("hi-IN").splitSentences(hindi)).toHaveLength(3);
  });

  it("returned Hindi as ONE sentence under the English splitter — the original bug", () => {
    const hindi = "यह पहला वाक्य है। यह दूसरा वाक्य है। यह तीसरा है।";
    expect(hindi.split(/(?<=[.!?])\s+/)).toHaveLength(1);
    // Which is why every sentence-count check silently switched off.
    expect(localeCraft("hi-IN").splitSentences(hindi).length).toBeGreaterThan(1);
  });

  it("still splits Latin punctuation in an Indic post, because real copy mixes both", () => {
    const mixed = "नया कलेक्शन आ गया है। Shop now. Limited stock.";
    expect(localeCraft("hi-IN").splitSentences(mixed)).toHaveLength(3);
  });

  it("splits English exactly as before", () => {
    const en = "First sentence. Second one! And a third?";
    expect(localeCraft("en-IN").splitSentences(en)).toHaveLength(3);
  });

  it("gives every supported language a working splitter", () => {
    for (const code of LANGUAGE_CODES) {
      expect(sentenceSplitter(code), code).toBeInstanceOf(RegExp);
      expect(localeCraft(code).splitSentences("one. two.").length, code).toBeGreaterThan(0);
    }
  });
});

describe("English word lists are not applied to other languages", () => {
  it("grades English with the phrase rules, as it always did", () => {
    const bad = "In today's fast-paced world, studies show that businesses need to leverage synergy.";
    const r = scoreDraft(bad);
    expect(r.issues.some((i) => i.code === "ai_tell")).toBe(true);
    expect(r.issues.some((i) => i.code === "vague_claim")).toBe(true);
  });

  it("does not pretend to have checked Hindi against English phrases", () => {
    // The point: no ai_tell/vague_claim issues are *invented* for Hindi, and equally none are
    // silently reported as clean when the list simply does not apply.
    const hindi = "हमने अपने ग्राहकों के लिए नया कलेक्शन तैयार किया है।";
    const r = scoreDraft(hindi, "hi-IN");
    expect(r.issues.some((i) => i.code === "ai_tell")).toBe(false);
    expect(r.issues.some((i) => i.code === "vague_claim")).toBe(false);
  });

  it("does not flag a Hindi opener with an English opener regex", () => {
    const hindi = "इन दिनों हर ब्रांड ऑनलाइन है।";
    expect(scoreDraft(hindi, "hi-IN").issues.some((i) => i.code === "weak_opening")).toBe(false);
  });
});

describe("structural checks still apply in every language", () => {
  it("catches a Hindi wall of prose with no break, list or short line", () => {
    const wall = Array.from({ length: 8 },
      (_, i) => `यह एक लंबा वाक्य है जिसमें कई शब्द हैं और यह ${i} नंबर का है।`).join(" ");
    const r = scoreDraft(wall, "hi-IN");
    expect(r.issues.some((i) => i.code === "monotone_shape")).toBe(true);
  });

  it("passes a Hindi post that is actually well shaped", () => {
    const good = "नया कलेक्शन आ गया है।\n\n- हाथ से बुना\n- सीमित स्टॉक\n- जयपुर में बना\n\nदेख लीजिए।";
    expect(scoreDraft(good, "hi-IN").issues.some((i) => i.code === "monotone_shape")).toBe(false);
  });

  it("uses a lower word threshold for Indic scripts than for Latin", () => {
    expect(localeCraft("hi-IN").monotoneMinWords).toBeLessThan(localeCraft("en-IN").monotoneMinWords);
  });
});

describe("existing callers are unaffected", () => {
  it("defaults to English when no language is passed", () => {
    const bad = "In today's fast-paced world we've got you covered.";
    expect(scoreDraft(bad)).toEqual(scoreDraft(bad, "en-IN"));
  });

  it("still refuses empty input", () => {
    expect(scoreDraft("").needsRewrite).toBe(true);
    expect(scoreDraft("", "hi-IN").needsRewrite).toBe(true);
  });
});
