import { afterEach, describe, expect, it, vi } from "vitest";

// Cancelling a stream. Before, streamText took no signal: a closed tab left the provider
// stream running to its end, billed, and a stream that had shown nothing yet fell through to
// the NEXT model — a fresh paid call for someone who had already left.

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

describe("a cancelled stream", () => {
  it("aborts the provider request and tries no other model", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk_test");
    const calls: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
      const s = init!.signal as AbortSignal;
      calls.push(s);
      // One chunk, then hang until aborted.
      const body = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "hi" } }] })}\n\n`));
          s.addEventListener("abort", () => c.error(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
        },
      });
      return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }));

    const { streamText } = await import("@/lib/services/llm-stream");
    const ac = new AbortController();
    const events: string[] = [];
    for await (const e of streamText("x", { signal: ac.signal })) {
      events.push(e.type);
      if (e.type === "text") ac.abort();
    }

    expect(calls).toHaveLength(1);
    expect(calls[0].aborted, "the provider request was left running").toBe(true);
    // Cancelled is not an error the person needs to read, and not a reason to fall back.
    expect(events).toEqual(["text"]);
  });

  it("an already-cancelled request opens nothing", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk_test");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const { streamText } = await import("@/lib/services/llm-stream");
    const ac = new AbortController(); ac.abort();
    for await (const _ of streamText("x", { signal: ac.signal })) { /* drain */ }
    expect(f).not.toHaveBeenCalled();
  });
});
