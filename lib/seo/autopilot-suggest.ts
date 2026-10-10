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

export async function suggestFix(site: string, path: string, business: string, deps: { fetchPage?: (url: string) => Promise<string> } = {}): Promise<Suggestion> {
  const url = new URL(path, site).toString();
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
  const title = (p.title ?? "").replace(/\s+/g, " ").trim().slice(0, 70);
  const description = (p.description ?? "").replace(/\s+/g, " ").trim().slice(0, 170);
  if (!title || !description) return { ok: false, error: "The draft came back incomplete. Try again." };

  const source = [page.title, page.description, page.h1, page.text, business].filter(Boolean).join(" ");
  if (unsupportedFigures(`${title} ${description}`, source).length) {
    return { ok: false, error: "The draft included a number that isn't on the page, so it was discarded. Try again, or write it yourself." };
  }
  return { ok: true, fix: { title, description, status: "suggested", before: { title: page.title, description: page.description }, at: Date.now() } };
}
