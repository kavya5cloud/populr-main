import type { Sql } from "@/lib/db";

/**
 * Sarvam-supported Indian languages + English fallback.
 * This is the ONLY language list in the codebase.
 */
export const LANGUAGE_CODES = [
  "en-IN",
  "hi-IN",
  "bn-IN",
  "gu-IN",
  "kn-IN",
  "ml-IN",
  "mr-IN",
  "or-IN",
  "pa-IN",
  "ta-IN",
  "te-IN",
  "as-IN",
] as const;

export type LanguageCode = (typeof LANGUAGE_CODES)[number];

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === "string" && (LANGUAGE_CODES as readonly string[]).includes(value);
}

export const DEFAULT_LANGUAGE: LanguageCode = "en-IN";

export const LANGUAGE_LABELS: Record<LanguageCode, string> = {
  "en-IN": "English (India)",
  "hi-IN": "Hindi (हिंदी)",
  "bn-IN": "Bengali (বাংলা)",
  "gu-IN": "Gujarati (ગુજરાતી)",
  "kn-IN": "Kannada (ಕನ್ನಡ)",
  "ml-IN": "Malayalam (മലയാളം)",
  "mr-IN": "Marathi (मराठी)",
  "or-IN": "Odia (ଓଡ଼ିଆ)",
  "pa-IN": "Punjabi (ਪੰਜਾਬੀ)",
  "ta-IN": "Tamil (தமிழ்)",
  "te-IN": "Telugu (తెలుగు)",
  "as-IN": "Assamese (অসমীয়া)",
};

export function isEnglish(language: LanguageCode): boolean {
  return language === DEFAULT_LANGUAGE;
}

/**
 * Server-side helper to read workspace language preference from Neon DB workspace state.
 */
export async function getWorkspaceLanguage(sql: Sql | null, tenant: string): Promise<LanguageCode> {
  if (!sql || !tenant) return DEFAULT_LANGUAGE;
  try {
    const rows = (await sql`SELECT state FROM workspaces WHERE wsid = ${tenant}`) as { state?: { profile?: { language?: string } } }[];
    const lang = rows[0]?.state?.profile?.language;
    return isLanguageCode(lang) ? lang : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}
