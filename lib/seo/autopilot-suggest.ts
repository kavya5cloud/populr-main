import { safeFetchText } from "@/lib/net/safe-fetch";
import { generateText } from "@/lib/services/llm";
import { HONESTY_RULES } from "@/lib/cmo/quality-rules";
import { unsupportedFigures } from "@/lib/whatsapp/business/agent";
import type { PageFix } from "./autopilot";

// Drafting a better title and description for one page of the customer's site.
//
// Read from the page as it is served, never invented: the model sees the page's own
// heading and text and is asked to say what is already there, better. Every number in a
// suggestion must appear on the page — "Rated #1 in Pune" or "Since 1998" can't be made up
// and then stamped into a search result under the business's name.

export type PageRead = { title: string | null; description: string | null; h1: string | null; text: string };

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
const strip = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

export function readPage(html: string): PageRead {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const desc = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]).find((t) => /name=["']description["']/i.test(t))?.match(/content=["']([^"']*)["']/i)?.[1];
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const body = html
    .replace(/<(script|style|noscript|svg|template|iframe)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|header|footer|aside)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  return {
    title: title ? strip(title) || null : null,
    description: desc ? strip(desc) || null : null,
    h1: h1 ? strip(h1) || null : null,
    text: strip(body).slice(0, 2500),
  };
}

export type Suggestion = { ok: true; fix: PageFix } | { ok: false; error: string };

/**
 * A path on the site, as a full URL — or null when it would leave the site. "//other.host/x"
 * is a path to the browser but a different host to `new URL`, and paths can arrive from a
 * public beacon.
 */
export function pageUrl(site: string, path: string): string | null {
  try {
    const u = new URL(path, site);
    return u.origin === new URL(site).origin ? u.toString() : null;
  } catch { return null; }
}

/**
 * What's wrong with a page's title and description, each on its own — or null when both are
 * fine. The audit's thresholds. Automatic mode fixes what's broken; it doesn't rewrite a
 * title someone already got right.
 */
export function needsFix(page: PageRead, homeTitle?: string | null): { title?: string; description?: string } | null {
  const t = page.title ?? "", d = page.description ?? "";
  const title = !t ? "no title" : t.length < 30 ? "title too short" : t.length > 60 ? "title too long"
    : homeTitle && t === homeTitle ? "same title as the home page" : undefined;
  const description = !d ? "no description" : d.length < 70 ? "description too short" : d.length > 160 ? "description too long" : undefined;
  return title || description ? { ...(title ? { title } : {}), ...(description ? { description } : {}) } : null;
}

/**
 * A drafted title or description cut to fit — never mid-word. A trailing " | Brand" goes first,
 * since the brand is the part a search result can most afford to lose; otherwise it's cut at
 * the last whole word. Matters most in automatic mode, where no one reads a draft before it's
 * live: "…Government of Kar" must never reach a search result.
 */
export function fitText(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const brandless = t.replace(/\s+[|–—·-]\s+[^|–—·]+$/, "").trim();
  if (brandless !== t && brandless.length <= max && brandless.length >= Math.min(30, max)) return brandless;
  const cut = t.slice(0, max + 1);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : t.slice(0, max)).replace(/[\s,;:|–—·-]+$/, "").trim();
}

export async function suggestFix(site: string, path: string, business: string, deps: { fetchPage?: (url: string) => Promise<string> } = {}): Promise<Suggestion> {
  const url = pageUrl(site, path);
  if (!url) return { ok: false, error: "That isn't a page on your site." };
  let html: string;
  try {
    html = deps.fetchPage ? await deps.fetchPage(url) : (await safeFetchText(url, { maxBytes: 1_500_000, timeoutMs: 10_000 })).text;
  } catch {
    return { ok: false, error: "Couldn't load that page. Check the address is public and try again." };
  }
  const page = readPage(html);
  if (page.text.length < 80 && !page.h1) return { ok: false, error: "That page has too little text to describe. Is it built entirely in JavaScript?" };

  const res = await generateText({
    cacheSalt: `autopilot:${url}:${Date.now()}`,
    prompt: [
      `Write a search-result title and description for one page of ${business}'s website.`,
      ``,
      `The page as it is now:`,
      `Current title: ${page.title ?? "(none)"}`,
      `Current description: ${page.description ?? "(none)"}`,
      `Main heading: ${page.h1 ?? "(none)"}`,
      `Text: ${page.text}`,
      ``,
      `Rules:`,
      `- Describe only what this page actually says. Don't add services, places, claims or offers it doesn't mention.`,
      HONESTY_RULES,
      `- Title: 30 to 60 characters, the most specific thing on the page first, then "| ${business}" if it fits.`,
      `- Description: 120 to 158 characters, plain and specific — what someone gets from this page. No "Welcome to".`,
      `- Write in the page's own language.`,
      ``,
      `Return ONLY JSON: {"title": "...", "description": "..."}`,
    ].join("\n"),
  });
  if (!res.ok) return { ok: false, error: "Couldn't draft a suggestion just now. Try again in a moment." };

  let p: { title?: string; description?: string };
  try { p = JSON.parse(res.text.slice(res.text.indexOf("{"), res.text.lastIndexOf("}") + 1)); } catch { return { ok: false, error: "The draft came back unreadable. Try again." }; }
  const title = fitText(p.title ?? "", 60);
  const description = fitText(p.description ?? "", 160);
  if (!title || !description) return { ok: false, error: "The draft came back incomplete. Try again." };

  const source = [page.title, page.description, page.h1, page.text, business].filter(Boolean).join(" ");
  if (unsupportedFigures(`${title} ${description}`, source).length) {
    return { ok: false, error: "The draft included a number that isn't on the page, so it was discarded. Try again, or write it yourself." };
  }
  return { ok: true, fix: { title, description, status: "suggested", before: { title: page.title, description: page.description }, at: Date.now() } };
}
