// The languages Populr can market in.
//
// One source of truth, and deliberately small. The codes are Sarvam's own
// (docs.sarvam.ai/api-reference/text/translate-text, verified Aug 2026) so nothing has to be
// mapped at the API boundary — a mapping table between our codes and theirs would be one
// more thing to keep in step for no benefit.
//
// Sarvam's translate endpoint accepts 22 scheduled languages. Listed here are the ones a
// business would plausibly market in today, plus English. Adding another is one row: the
// quality gate reads its behaviour from this table rather than from a switch statement, so
// nothing else has to change.

import type { Sql } from "@/lib/db";

export const LANGUAGES = {
  "en-IN": { name: "English",  native: "English",  script: "latin",     terminator: ".", spaced: true },
  "hi-IN": { name: "Hindi",    native: "हिन्दी",     script: "devanagari", terminator: "।", spaced: true },
  "mr-IN": { name: "Marathi",  native: "मराठी",     script: "devanagari", terminator: "।", spaced: true },
  "bn-IN": { name: "Bengali",  native: "বাংলা",      script: "bengali",    terminator: "।", spaced: true },
  "ta-IN": { name: "Tamil",    native: "தமிழ்",     script: "tamil",      terminator: ".", spaced: true },
  "te-IN": { name: "Telugu",   native: "తెలుగు",     script: "telugu",     terminator: ".", spaced: true },
  "kn-IN": { name: "Kannada",  native: "ಕನ್ನಡ",     script: "kannada",    terminator: ".", spaced: true },
  "ml-IN": { name: "Malayalam", native: "മലയാളം",  script: "malayalam",  terminator: ".", spaced: true },
  "gu-IN": { name: "Gujarati", native: "ગુજરાતી",    script: "gujarati",   terminator: "।", spaced: true },
  "pa-IN": { name: "Punjabi",  native: "ਪੰਜਾਬੀ",     script: "gurmukhi",   terminator: "।", spaced: true },
  // Verified present in Sarvam's documented source/target enum alongside the ten above
  // (docs.sarvam.ai/api-reference/text/translate-text). Odia takes the danda like the other
  // eastern Indo-Aryan scripts.
  "od-IN": { name: "Odia",     native: "ଓଡ଼ିଆ",      script: "odia",       terminator: "।", spaced: true },
} as const;

export type LanguageCode = keyof typeof LANGUAGES;
export type Language = (typeof LANGUAGES)[LanguageCode];

/** What Populr writes in unless told otherwise. */
export const DEFAULT_LANGUAGE: LanguageCode = "en-IN";

export const LANGUAGE_CODES = Object.keys(LANGUAGES) as LanguageCode[];

export function isLanguageCode(v: unknown): v is LanguageCode {
  return typeof v === "string" && v in LANGUAGES;
}

/** Never throws: an unknown code falls back to English rather than failing a generation. */
export function language(code: string | null | undefined): Language {
  return isLanguageCode(code) ? LANGUAGES[code] : LANGUAGES[DEFAULT_LANGUAGE];
}

export function languageCode(code: string | null | undefined): LanguageCode {
  return isLanguageCode(code) ? code : DEFAULT_LANGUAGE;
}

/**
 * How a sentence ends in this language.
 *
 * The reason this table exists at all. Hindi, Marathi, Gujarati, Punjabi and Bengali end
 * sentences with the danda `।`, not a full stop — so a splitter that only knows `.!?`
 * returns an entire Hindi post as one sentence. Every check built on sentence count then
 * silently stops working: the monotone-shape rule sees one sentence and passes, the opener
 * length cap measures the whole post. The gate does not fail loudly, it disappears, on
 * exactly the content the founder cannot proofread.
 *
 * Latin punctuation stays in the pattern for every language because real Indian marketing
 * copy mixes both, often in the same line.
 */
export function sentenceSplitter(code: LanguageCode): RegExp {
  // language() rather than LANGUAGES[code]: this is exported, and a direct index throws on
  // a code that slipped past the type — which for a grader means a generation dies rather
  // than being graded in English.
  const t = language(code).terminator;
  return t === "।" ? /(?<=[।.!?])\s+/ : /(?<=[.!?])\s+/;
}

/**
 * For the UI: "Hindi (हिन्दी)", and just "English" where the two would repeat.
 *
 * Lives here rather than beside the translation client so that rendering a label does not
 * drag in a Sarvam HTTP client, its env handling and its fetch — which is what happened the
 * first time, when Studio imported it from localize.ts.
 */
export function localeLabel(code: LanguageCode): string {
  const l = language(code);
  return l.name === l.native ? l.name : `${l.name} (${l.native})`;
}

/** English is the only language whose phrase-level craft lists were written for it. */
export function isEnglish(code: LanguageCode): boolean {
  return code === "en-IN";
}

/**
 * The language a workspace has chosen, read server-side.
 *
 * The automated path has no browser to ask, so the preference has to come back out of the
 * same `workspaces.state.profile` the client wrote it to. Never throws and never returns
 * undefined: a missing row, an unreadable database or a code we no longer ship all mean
 * English, because a scheduled post going out in the wrong language is a worse failure
 * than one going out in the default.
 */
export async function getWorkspaceLanguage(sql: Sql | null, tenant: string): Promise<LanguageCode> {
  if (!sql || !tenant) return DEFAULT_LANGUAGE;
  try {
    const rows = (await sql`SELECT state FROM workspaces WHERE wsid = ${tenant}`) as
      { state?: { profile?: { language?: string } } }[];
    const lang = rows[0]?.state?.profile?.language;
    return isLanguageCode(lang) ? lang : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}
