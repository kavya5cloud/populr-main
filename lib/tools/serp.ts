// How a title and description fit in a Google result.
//
// Google cuts by width, not by character count: a title of capital Ws runs out long before
// one of lower-case i's. These are the widths it's commonly measured to cut at on desktop —
// about 600px for a title in 20px Arial, and about 920px (two lines) for a description in
// 14px Arial. The page measures with the real font in the browser; `approxWidth` stands in
// where there's no canvas (the server render, and tests).

export const TITLE = { maxPx: 600, font: "20px Arial", sizePx: 20 } as const;
export const DESCRIPTION = { maxPx: 920, font: "14px Arial", sizePx: 14 } as const;

export type Measure = (text: string) => number;

/** Arial's widths by character class, as a fraction of the font size. Close, not exact. */
export function approxWidth(text: string, sizePx: number): number {
  let em = 0;
  for (const ch of text) {
    if (/[ijlI.,;:!|'`]/.test(ch)) em += 0.26;
    else if (/[ fJrt()[\]{}\-/"]/.test(ch)) em += 0.33;
    else if (/[mwMW@%]/.test(ch)) em += 0.86;
    else if (/[A-Z]/.test(ch)) em += 0.68;
    else if (/[0-9]/.test(ch)) em += 0.56;
    else if (/[a-z]/.test(ch)) em += 0.52;
    else em += 0.6;
  }
  return em * sizePx;
}

/** The text as Google would show it: whole if it fits, else cut at a word with "…". */
export function fitToWidth(text: string, maxPx: number, measure: Measure): { shown: string; truncated: boolean; px: number } {
  const clean = text.replace(/\s+/g, " ").trim();
  const px = measure(clean);
  if (px <= maxPx) return { shown: clean, truncated: false, px };
  let lo = 0, hi = clean.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(clean.slice(0, mid).trimEnd() + " …") <= maxPx) lo = mid; else hi = mid - 1;
  }
  let cut = clean.slice(0, lo);
  const space = cut.lastIndexOf(" ");
  if (space > lo * 0.6) cut = cut.slice(0, space);
  return { shown: cut.replace(/[\s,.;:–—-]+$/, "") + " …", truncated: true, px };
}

export type Advice = { level: "good" | "warn" | "bad"; text: string };

export function titleAdvice(title: string, px: number): Advice[] {
  const t = title.trim();
  if (!t) return [{ level: "bad", text: "No title. Google will make one up from the page — usually the first heading." }];
  const out: Advice[] = [];
  if (px > TITLE.maxPx) out.push({ level: "warn", text: `About ${Math.round(px)}px wide — Google shows roughly ${TITLE.maxPx}px, so the end is cut. Put what matters first.` });
  else if (t.length < 30) out.push({ level: "warn", text: `${t.length} characters. There's room to say what the page is for — the thing someone would search.` });
  else out.push({ level: "good", text: `${t.length} characters, about ${Math.round(px)}px — fits in one line.` });
  if (/^(home|welcome|untitled)\b/i.test(t)) out.push({ level: "warn", text: `Starts with "${t.split(/\s/)[0]}" — the first words carry the most weight, and this one says nothing about the page.` });
  if (t === t.toUpperCase() && /[A-Z]/.test(t)) out.push({ level: "warn", text: "All capitals reads as shouting, and Google often rewrites titles like this." });
  return out;
}

export function descriptionAdvice(description: string, px: number): Advice[] {
  const d = description.trim();
  if (!d) return [{ level: "warn", text: "No description. Google will pick a passage from the page, which may not be the one you'd choose." }];
  const out: Advice[] = [];
  if (px > DESCRIPTION.maxPx) out.push({ level: "warn", text: `Runs past two lines (about ${Math.round(px)}px) — the end is cut on desktop, and more on phones.` });
  else if (d.length < 70) out.push({ level: "warn", text: `${d.length} characters. Too short to say what someone gets from the page — aim for 120 to 155.` });
  else out.push({ level: "good", text: `${d.length} characters — fits.` });
  if (/^welcome to\b/i.test(d)) out.push({ level: "warn", text: "\"Welcome to…\" spends the first words on nothing. Start with what the page offers." });
  return out;
}
