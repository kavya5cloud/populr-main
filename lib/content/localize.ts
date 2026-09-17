import { languageCode, type LanguageCode } from "@/lib/i18n/languages";

// Localising content that already exists.
//
// Deliberately NOT part of the LLM provider chain in lib/services/llm.ts. That chain exists
// so a failing provider can be replaced by another one that does the same job — and nothing
// else in it translates. Falling through from a translate call to a chat model would not
// degrade the operation, it would silently change what the operation is, and the caller
// would get plausible text that was never a translation.
//
// So this is a separate capability with its own failure mode: it works or it says it didn't.
//
// It is also not the path for new content. New content is generated natively in the target
// language by composeWithAi — English-then-translate reads translated, and a regional
// audience notices that before it notices anything else. This is for the case where a piece
// already exists in one language and needs to appear in another.
//
// Verified against docs.sarvam.ai (Aug 2026):
//   POST https://api.sarvam.ai/translate
//   { input, source_language_code, target_language_code, mode, model, output_script }
//   → { request_id, translated_text, source_language_code }
//   Max input: 1000 chars (mayura:v1), 2000 (sarvam-translate:v1)

const ENDPOINT = "https://api.sarvam.ai/translate";

/** Sarvam's documented ceiling for sarvam-translate:v1. Longer input is split, not truncated. */
const MAX_INPUT = 2000;

const TIMEOUT_MS = 20_000;

/**
 * Things a translator must hand back unchanged.
 *
 * Each is replaced by an opaque token before the text is sent and restored afterwards. The
 * alternative — asking the model nicely to preserve them — fails in the way that costs most:
 * a URL comes back transliterated into Devanagari and the link is dead, and nobody notices
 * until a campaign has run.
 *
 * Order matters. Markdown links are matched before bare URLs so the URL inside `[text](url)`
 * is not tokenised twice.
 */
const PROTECT: { code: string; re: RegExp }[] = [
  { code: "MDLINK", re: /\[[^\]]*\]\([^)]+\)/g },
  { code: "URL", re: /\bhttps?:\/\/[^\s<>"')]+/g },
  { code: "EMAIL", re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g },
  { code: "HANDLE", re: /(?:^|\s)[@#][\w][\w.-]*/g },
  { code: "CODE", re: /`[^`]+`/g },
  // Money and figures. A price translated into native numerals is a price the reader cannot
  // match against the website.
  { code: "MONEY", re: /(?:₹|Rs\.?|INR|\$)\s?\d[\d,]*(?:\.\d+)?/gi },
  { code: "NUM", re: /\b\d[\d,]*(?:\.\d+)?%?\b/g },
];

export type Protected = { token: string; original: string; kind: string };

export type LocalizeOptions = {
  /** Defaults to English. `auto` is supported by the API but we prefer to be explicit. */
  from?: LanguageCode | "auto";
  /**
   * Additional strings to hand back untouched — product names, brand terms, feature names.
   * The brand's own vocabulary is the thing most worth protecting and the thing a general
   * translator is most likely to helpfully translate.
   */
  keep?: string[];
  /** Sarvam's register. "modern-colloquial" reads closest to how marketing is actually written. */
  mode?: "formal" | "modern-colloquial" | "classic-colloquial" | "code-mixed";
  signal?: AbortSignal;
};

export type LocalizeResult =
  | { ok: true; text: string; from: string; protectedItems: Protected[] }
  | { ok: false; error: string; status?: number };

/** Swap protected spans for tokens. Returns the masked text and how to put it back. */
export function mask(text: string, keep: string[] = []): { masked: string; items: Protected[] } {
  const items: Protected[] = [];
  let masked = text;
  let n = 0;

  // Caller-supplied terms first: a product name may itself contain a number or a URL-ish
  // fragment, and it should survive as one unit rather than being split by a later pattern.
  for (const term of keep.filter(Boolean).sort((a, b) => b.length - a.length)) {
    const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    masked = masked.replace(re, () => {
      const token = `⦙KEEP${n}⦙`;
      items.push({ token, original: term, kind: "KEEP" });
      n++;
      return token;
    });
  }

  for (const { code, re } of PROTECT) {
    masked = masked.replace(re, (m) => {
      // The handle pattern captures a leading space; keep it outside the token.
      const lead = code === "HANDLE" && /^\s/.test(m) ? m[0] : "";
      const body = lead ? m.slice(1) : m;
      const token = `⦙${code}${n}⦙`;
      items.push({ token, original: body, kind: code });
      n++;
      return lead + token;
    });
  }
  return { masked, items };
}

/** Put the originals back. */
export function unmask(text: string, items: Protected[]): string {
  let out = text;
  for (const it of items) out = out.split(it.token).join(it.original);
  return out;
}

/**
 * Split on paragraph boundaries so no chunk exceeds the API limit.
 *
 * Paragraphs rather than characters: cutting mid-sentence gives the translator half a
 * thought and it returns half a translation. A single paragraph longer than the limit is
 * passed through as-is and the API's own error is surfaced rather than silently truncating
 * someone's copy.
 */
export function chunk(text: string, limit = MAX_INPUT): string[] {
  if (text.length <= limit) return [text];
  const out: string[] = [];
  let buf = "";
  for (const para of text.split(/\n\s*\n/)) {
    const candidate = buf ? `${buf}\n\n${para}` : para;
    if (candidate.length > limit && buf) {
      out.push(buf);
      buf = para;
    } else {
      buf = candidate;
    }
  }
  if (buf) out.push(buf);
  return out;
}

/**
 * Translate existing copy into `target`, preserving everything that must not change.
 *
 * Never throws. A failure returns `{ ok: false }` with a reason, because the caller is
 * usually showing a founder their own content and an exception there loses the original.
 */
export async function localize(
  text: string,
  target: LanguageCode,
  opts: LocalizeOptions = {},
): Promise<LocalizeResult> {
  const key = (process.env.SARVAM_API_KEY || "").trim();
  if (!key) return { ok: false, error: "not_configured" };
  if (!text.trim()) return { ok: true, text, from: String(opts.from ?? "en-IN"), protectedItems: [] };

  const from = opts.from === "auto" ? "auto" : languageCode(opts.from);
  const { masked, items } = mask(text, opts.keep);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  // The caller's own cancellation still wins.
  opts.signal?.addEventListener("abort", () => controller.abort(), { once: true });

  try {
    const parts: string[] = [];
    for (const piece of chunk(masked)) {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          input: piece,
          source_language_code: from,
          target_language_code: target,
          // sarvam-translate:v1 covers all 22 scheduled languages and takes 2000 chars;
          // mayura:v1 covers 12 and takes 1000.
          model: "sarvam-translate:v1",
          mode: opts.mode ?? "modern-colloquial",
          output_script: "fully-native",
          // International numerals, so a price still matches the website it points at.
          numerals_format: "international",
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        // The body is deliberately not read. It would only be logged, and an upstream error
        // body can echo the request — which here is the customer's own copy.
        // Logged without the content being translated: that is the customer's copy, and it
        // has no business in our logs.
        console.warn(JSON.stringify({
          event: "localize_failed", status: res.status, target, chars: piece.length,
        }));
        // 403 is Sarvam's auth failure, not 401 — see the provider config in llm.ts.
        const error = res.status === 403 ? "auth_failed"
          : res.status === 429 ? "rate_limited"
          : `http_${res.status}`;
        return { ok: false, error, status: res.status };
      }

      const json = (await res.json()) as { translated_text?: string };
      if (typeof json.translated_text !== "string") {
        return { ok: false, error: "unexpected_response" };
      }
      parts.push(json.translated_text);
    }

    return {
      ok: true,
      text: unmask(parts.join("\n\n"), items),
      from,
      protectedItems: items,
    };
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    console.warn(JSON.stringify({ event: "localize_error", target, aborted }));
    return { ok: false, error: aborted ? "timeout" : "network_error" };
  } finally {
    clearTimeout(timer);
  }
}
