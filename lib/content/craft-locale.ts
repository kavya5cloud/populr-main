import { isEnglish, language, sentenceSplitter, type LanguageCode } from "@/lib/i18n/languages";

// Which craft checks survive a change of language, and which do not.
//
// lib/content/craft.ts was written for English and is the gate that decides whether a draft
// ships. Run a Hindi post through it unchanged and it does not misfire — it silently passes:
// none of the English AI_TELLS match, none of the WEAK_OPENINGS regexes match, and the
// sentence splitter finds no `.` so the whole post counts as one sentence, which switches
// off the monotone-shape check and makes the opener length cap meaningless.
//
// A gate that quietly stops gating is worse than no gate, because the product goes on
// claiming its drafts are graded. This file decides, per language, what can still be judged.
//
// The rule applied throughout: a check transfers if it measures *structure*, and does not if
// it matches *English words*. Sentence length, line breaks and rhythm are structural. "in
// today's fast-paced world" is a list of English strings, and running it against Hindi finds
// nothing while implying it looked.

export type LocaleCraft = {
  /** Split on this language's sentence terminator. */
  splitSentences(text: string): string[];
  /** Whether the English phrase lists (AI tells, vague claims) mean anything here. */
  usesEnglishPhraseRules: boolean;
  /** Whether the English opener regexes mean anything here. */
  usesEnglishOpenerRules: boolean;
  /**
   * Structural checks always apply, but the thresholds do not transfer unchanged.
   * Devanagari and Tamil pack more meaning per word than English, so a line that reads as
   * punchy in Hindi has fewer words than its English equivalent.
   */
  monotoneMinWords: number;
};

/**
 * Word counts are not comparable across scripts.
 *
 * English craft rules treat ~25 words as the point where a sentence stops being punchy.
 * Devanagari and the southern scripts carry more per word — Hindi compounds postpositions
 * and drops articles — so the same threshold flags ordinary Hindi prose as a wall. Twenty is
 * the working figure; it is a judgement, not a measurement, and it is written down here so
 * it can be corrected in one place when someone who reads the language disagrees.
 */
const MONOTONE_MIN_WORDS_LATIN = 25;
const MONOTONE_MIN_WORDS_INDIC = 20;

export function localeCraft(code: LanguageCode): LocaleCraft {
  const english = isEnglish(code);
  const splitter = sentenceSplitter(code);
  const latin = language(code).script === "latin";

  return {
    splitSentences(text: string): string[] {
      return text
        .replace(/\s+/g, " ")
        .split(splitter)
        .map((s) => s.trim())
        .filter(Boolean);
    },
    // Both of these are lists of English strings. Applying them to another language finds
    // nothing and reports a clean draft, which is the failure this file exists to name.
    usesEnglishPhraseRules: english,
    usesEnglishOpenerRules: english,
    monotoneMinWords: latin ? MONOTONE_MIN_WORDS_LATIN : MONOTONE_MIN_WORDS_INDIC,
  };
}

/**
 * Whether we can meaningfully grade prose in this language at all.
 *
 * True for every language in the table: structural checks — does it open on one line, is
 * every sentence the same length, does it use line breaks — work in any script. Kept as an
 * explicit function rather than assumed, so that adding a language with no working splitter
 * has somewhere to say so instead of being graded badly.
 */
export function canGrade(code: LanguageCode): boolean {
  return localeCraft(code).splitSentences("x").length > 0;
}
