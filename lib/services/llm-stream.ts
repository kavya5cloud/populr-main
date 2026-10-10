import { PROVIDERS, SYSTEM_PROMPT_FOR_STREAM, streamConfig, rememberDeadModel } from "./llm";

// Streaming generation.
//
// Everything else in this codebase waits for a complete response and then shows it. That is
// correct for anything the code reads — a JSON profile, a routed decision — and wrong for
// anything a person reads, because twenty seconds of nothing followed by four paragraphs
// feels broken in a way that twenty seconds of arriving text does not. The work takes the
// same time either way; only one of them is bearable.
//
// Two deliberate limits, both about honesty rather than effort:
//
//   Fallback happens before the first byte, never after. Once text has reached the browser,
//   switching provider would mean either replaying from the start or splicing two different
//   answers together. So: if a provider fails to open a stream, the next one is tried; if it
//   fails halfway through, the stream ends and says so.
//
//   Nothing streamed is cached. The cache stores complete answers, and a truncated stream is
//   not one. A half answer served later as a whole one is worse than a slow answer.

export type StreamEvent =
  | { type: "text"; value: string }
  | { type: "done"; provider: string; model: string; chars: number }
  | { type: "error"; message: string };

/** How long to wait for the first byte before giving up on a provider. */
const OPEN_TIMEOUT_MS = 20_000;
/** Total budget once streaming has started. Generous — long answers are the point. */
const STREAM_TIMEOUT_MS = 120_000;

/**
 * Pull text out of one server-sent-events line.
 *
 * The two provider families disagree about shape but agree on transport, so the difference
 * is contained here rather than in two parallel readers.
 */
function textFromChunk(json: unknown, kind: "gemini" | "openai_compatible"): string {
  const d = json as Record<string, any>;
  if (kind === "gemini") {
    const parts = d?.candidates?.[0]?.content?.parts;
    return Array.isArray(parts) ? parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("") : "";
  }
  const delta = d?.choices?.[0]?.delta?.content;
  return typeof delta === "string" ? delta : "";
}

/**
 * Whether a chunk says the model stopped early.
 *
 * The non-streaming path treats truncation as a failure so the chain can try another model.
 * Mid-stream there is no such option — the text is already on screen — so the honest move is
 * to say the answer was cut off rather than let it end mid-sentence and look like the model
 * had nothing more to say.
 */
function truncatedInChunk(json: unknown, kind: "gemini" | "openai_compatible"): boolean {
  const d = json as Record<string, any>;
  const reason = kind === "gemini" ? d?.candidates?.[0]?.finishReason : d?.choices?.[0]?.finish_reason;
  return reason === "MAX_TOKENS" || reason === "length";
}

async function openStream(
  provider: (typeof PROVIDERS)[number],
  model: string,
  key: string,
  prompt: string,
  signal: AbortSignal,
): Promise<Response | null> {
  const cfg = streamConfig();
  // The provider's own budget, exactly as the non-streaming path uses it.
  //
  // This read the shared 4,096 for every provider, which is the number that makes a
  // reasoning model return content: null — it spends the whole allowance thinking and
  // never writes. The non-streaming path was fixed for that and this one was not, so
  // streaming through Sarvam would have failed in a way the non-streaming path no longer
  // does, which is the worst kind of inconsistency: the same provider behaving differently
  // depending on which code path reached it.
  const maxOutput = provider.capabilities.maxOutputTokens ?? cfg.maxOutputTokens;
  const body =
    provider.kind === "gemini"
      ? JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT_FOR_STREAM }] },
          generationConfig: { temperature: cfg.temperature, maxOutputTokens: maxOutput },
        })
      : JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT_FOR_STREAM },
            { role: "user", content: prompt },
          ],
          max_tokens: maxOutput,
          temperature: cfg.temperature,
          stream: true,
        });

  // Gemini streams from a different method on the same path; the OpenAI-compatible ones use
  // the same endpoint with stream:true in the body.
  const endpoint =
    provider.kind === "gemini"
      ? `${provider.url}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`
      : provider.url;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [provider.authHeader]: provider.authHeader === "Authorization" ? "Bearer " + key : key,
        "User-Agent": "populr/1.0",
      },
      body,
      signal,
    });
    if (!res.ok || !res.body) {
      // Read the body before discarding the response. A retired model and a bad endpoint
      // both answer 404, and only what the provider actually said separates them — so the
      // status alone could never decide whether to stop asking for this model.
      const body = await res.text().catch(() => "");
      const retired = rememberDeadModel(provider.name, model, res.status, body);
      console.info(JSON.stringify({
        event: "llm_stream_open_failed",
        provider: provider.name,
        model,
        status: res.status,
        // Logged so the first stream that retires a model is findable, rather than the
        // retirement being an invisible side effect of a failed open.
        ...(retired ? { modelRetired: true } : {}),
      }));
      return null;
    }
    return res;
  } catch {
    return null;
  }
}

/**
 * Stream a completion, falling back between providers only before the first byte.
 *
 * Yields plain events rather than writing a wire format, so the route decides how to frame
 * them and this stays testable without a server.
 */
/**
 * `signal` is the caller's: when the person closes the tab, the provider stream is cancelled
 * too, and no other model is tried. Without it a cancelled stream kept running to its end,
 * billed, and one that had shown nothing yet fell through to the next model — a fresh paid
 * call for someone who had already left.
 */
export async function* streamText(prompt: string, opts: { signal?: AbortSignal } = {}): AsyncGenerator<StreamEvent> {
  const { signal } = opts;
  if (signal?.aborted) return;
  const cfg = streamConfig();
  if (!cfg.providers.length) {
    yield { type: "error", message: "No AI provider is configured." };
    return;
  }

  for (const { provider, key } of cfg.providers) {
    for (const model of provider.models) {
      if (signal?.aborted) return;
      const controller = new AbortController();
      const onCancel = () => controller.abort();
      signal?.addEventListener("abort", onCancel, { once: true });
      const openTimer = setTimeout(() => controller.abort(), OPEN_TIMEOUT_MS);
      const res = await openStream(provider, model, key, prompt, controller.signal);
      clearTimeout(openTimer);
      if (signal?.aborted) { signal.removeEventListener("abort", onCancel); return; }
      if (!res?.body) { signal?.removeEventListener("abort", onCancel); continue; }   // before the first byte — the next model is fair game

      // Whole-stream budget, from the provider where it declares one. Sarvam is measured
      // at roughly 55 seconds end to end with its first content chunk at 14, so a provider
      // that declares it is slow must be allowed to be slow here too.
      const streamTimer = setTimeout(() => controller.abort(), provider.capabilities.timeoutMs ?? STREAM_TIMEOUT_MS);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let chars = 0;
      let truncated = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE frames are separated by a blank line; a partial frame stays in the buffer.
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            for (const line of frame.split("\n")) {
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;
              let json: unknown;
              try { json = JSON.parse(payload); } catch { continue; }

              if (truncatedInChunk(json, provider.kind)) truncated = true;
              const text = textFromChunk(json, provider.kind);
              if (text) { chars += text.length; yield { type: "text", value: text }; }
            }
          }
        }
      } catch {
        clearTimeout(streamTimer);
        signal?.removeEventListener("abort", onCancel);
        // Cancelled by the caller: not a failure, and not a reason to try another model.
        if (signal?.aborted) return;
        // Mid-stream failure. No fallback is possible without replaying, so say what
        // happened — silence here reads as the model simply stopping.
        if (chars === 0) continue;   // nothing was shown yet, so the next model is still fair
        yield { type: "error", message: "The response was cut off. Try again." };
        return;
      }
      clearTimeout(streamTimer);
      signal?.removeEventListener("abort", onCancel);

      if (chars === 0) continue;   // opened but said nothing — treat as a failed attempt

      if (truncated) yield { type: "error", message: "The response hit its length limit." };
      yield { type: "done", provider: provider.name, model, chars };
      console.info(JSON.stringify({ event: "llm_stream", provider: provider.name, model, chars, truncated }));
      return;
    }
  }

  yield { type: "error", message: "Every provider failed to respond." };
}
