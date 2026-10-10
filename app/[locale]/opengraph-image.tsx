import { LANDING, LANDING_LOCALES, type LandingLocale } from "@/lib/i18n/landing";
import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og-card";

// Each language version shares with a card in its own language — a French link pasted into
// a French group chat should not unfurl in English.
//
// Caveat: the card renders with system fonts. Devanagari and Polish diacritics depend on
// the renderer having glyphs for them.

export const alt = "Populr";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export function generateStaticParams() {
  return LANDING_LOCALES.map((locale) => ({ locale }));
}

export default async function Image({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const c = LANDING[(LANDING_LOCALES as readonly string[]).includes(locale) ? (locale as LandingLocale) : "fr"];
  return ogCard({ eyebrow: c.name, title: `${c.h1} ${c.h1Tail}`, sub: c.under });
}
