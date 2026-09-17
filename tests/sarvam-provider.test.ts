import { describe, expect, it } from "vitest";
import { PROVIDERS, RETIRED_MODELS } from "@/lib/services/llm";

// Sarvam joins the existing chain rather than replacing anything. These pin the two
// properties that matter: it is configured the same way every other provider is, and adding
// it changed nothing about how the others resolve.

const sarvam = () => PROVIDERS.find((p) => p.name === "sarvam")!;

describe("Sarvam is a provider like the others", () => {
  it("is registered", () => {
    expect(sarvam()).toBeTruthy();
  });

  it("uses the OpenAI-compatible path, so no transport code was duplicated", () => {
    // Verified against docs.sarvam.ai: POST /v1/chat/completions, messages[] in,
    // choices[0].message.content out. Same builder as Groq and OpenAI.
    expect(sarvam().kind).toBe("openai_compatible");
    expect(sarvam().authHeader).toBe("Authorization");
    expect(sarvam().url).toBe("https://api.sarvam.ai/v1/chat/completions");
  });

  it("reads its key from the environment and nowhere else", () => {
    expect(sarvam().env).toBe("SARVAM_API_KEY");
    // No key material in the config itself.
    expect(JSON.stringify(sarvam())).not.toMatch(/sk[_-][A-Za-z0-9]{8,}/);
  });

  it("ships no model the API does not expose", () => {
    // Only sarvam-105b and sarvam-105b-conversations exist on v1. Sarvam-M (24B) was
    // deprecated and there is no 30B — listing one would 404 on every request before the
    // fallback caught it, which is the exact failure this codebase has had twice with Groq.
    for (const m of sarvam().models) {
      expect(["sarvam-105b", "sarvam-105b-conversations"], m).toContain(m);
    }
  });

  it("carries no prefix guard, because the documented key format is contradictory", () => {
    // The chat reference shows `sk_xxx`; the auth page states no format. A wrong guard makes
    // a valid key look unconfigured and the provider vanishes silently.
    expect(sarvam().prefix).toBe("");
  });

  it("lists no retired model", () => {
    for (const m of sarvam().models) expect(RETIRED_MODELS).not.toContain(m);
  });
});

describe("adding it changed nothing about the existing chain", () => {
  it("keeps the established providers in their original order", () => {
    const others = PROVIDERS.filter((p) => p.name !== "sarvam").map((p) => p.name);
    expect(others).toEqual(["gemini", "groq", "openai"]);
  });

  it("is last, so no existing deployment resolves differently", () => {
    // Not merely "after gemini and groq". Sitting above OpenAI would change resolution for
    // anyone holding both an OpenAI and a Sarvam key — small, silent, and exactly the kind
    // of change the brief said not to make. Sarvam is reached only via preferProvider or
    // when nothing above it is configured.
    expect(PROVIDERS[PROVIDERS.length - 1].name).toBe("sarvam");
  });

  it("leaves every provider with a model to try", () => {
    for (const p of PROVIDERS) expect(p.models.length, p.name).toBeGreaterThan(0);
  });
});

// ── Failure behaviour, exercised rather than asserted from the source ───────
//
// The point of using kind:"openai_compatible" is that Sarvam inherits the retry, backoff
// and classification the other providers already have. These drive generateText with a
// stubbed fetch and count the calls, because "it reuses the existing logic" is a claim
// about behaviour and only behaviour can confirm it.

import { beforeEach, afterEach, vi } from "vitest";
import { generateText } from "@/lib/services/llm";

const KEYS = ["GEMINI_API_KEY", "GROQ_API_KEY", "OPENAI_API_KEY", "SARVAM_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};

/** Only Sarvam configured, so the chain is exactly one provider and counts are unambiguous. */
function onlySarvam() {
  for (const k of KEYS) process.env[k] = k === "SARVAM_API_KEY" ? "test-key" : "";
}

const chatOk = (text: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: "stop" }] }),
    { status: 200, headers: { "Content-Type": "application/json" } });

describe("Sarvam inherits the existing failure handling", () => {
  beforeEach(() => { for (const k of KEYS) saved[k] = process.env[k]; });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });

  it("returns text on a successful call, with no database needed", async () => {
    onlySarvam();
    vi.stubGlobal("fetch", vi.fn(async () => chatOk("नमस्ते")));
    const r = await generateText({ prompt: "hi", sql: null });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.text).toBe("नमस्ते"); expect(r.provider).toBe("sarvam"); }
  });

  it("sends the key as a Bearer header and never in the body", async () => {
    onlySarvam();
    const f = vi.fn(async () => chatOk("ok"));
    vi.stubGlobal("fetch", f);
    await generateText({ prompt: "hi", sql: null });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.sarvam.ai/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect(String(init.body)).not.toContain("test-key");
  });

  it("does NOT retry a 403 — a bad key is permanent, not transient", async () => {
    onlySarvam();
    const f = vi.fn(async () => new Response("forbidden", { status: 403 }));
    vi.stubGlobal("fetch", f);
    const r = await generateText({ prompt: "hi", sql: null });
    expect(r.ok).toBe(false);
    // One attempt. Retrying a rejected key burns the request budget for nothing.
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a 401 either", async () => {
    onlySarvam();
    const f = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", f);
    await generateText({ prompt: "hi", sql: null });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 with the existing backoff before giving up", async () => {
    onlySarvam();
    const f = vi.fn(async () => new Response("slow down", { status: 429 }));
    vi.stubGlobal("fetch", f);
    const r = await generateText({ prompt: "hi", sql: null });
    expect(r.ok).toBe(false);
    // Rate limiting is transient, so it is retried rather than abandoned on first sight.
    expect(f.mock.calls.length).toBeGreaterThan(1);
  }, 20_000);

  it("retries a 500 and a 503, which are the upstream's problem not ours", async () => {
    for (const status of [500, 503]) {
      onlySarvam();
      const f = vi.fn(async () => new Response("upstream", { status }));
      vi.stubGlobal("fetch", f);
      await generateText({ prompt: "hi", sql: null });
      expect(f.mock.calls.length, `status ${status}`).toBeGreaterThan(1);
      vi.unstubAllGlobals();
    }
  }, 30_000);

  it("survives a network failure without throwing", async () => {
    onlySarvam();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));
    const r = await generateText({ prompt: "hi", sql: null });
    expect(r.ok).toBe(false);
  }, 20_000);

  it("treats a 200 with no usable text as a failure, not as an answer", async () => {
    onlySarvam();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const r = await generateText({ prompt: "hi", sql: null });
    expect(r.ok).toBe(false);
  }, 20_000);

  it("is simply absent when SARVAM_API_KEY is missing", async () => {
    for (const k of KEYS) process.env[k] = "";
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const r = await generateText({ prompt: "hi", sql: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("no_api_key");
    expect(f).not.toHaveBeenCalled();
  });
});

describe("preferProvider reorders and never truncates", () => {
  beforeEach(() => { for (const k of KEYS) saved[k] = process.env[k]; });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });

  it("tries Sarvam first when asked, though it is last by default", async () => {
    process.env.SARVAM_API_KEY = "sarvam-key";
    process.env.GROQ_API_KEY = "gsk_groq";
    process.env.GEMINI_API_KEY = "";
    process.env.OPENAI_API_KEY = "";
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL) => {
      seen.push(String(u));
      return chatOk("ok");
    }));
    await generateText({ prompt: "hi", sql: null, preferProvider: "sarvam" });
    expect(seen[0]).toContain("api.sarvam.ai");
  });

  it("still falls through to the other providers when the preferred one fails", async () => {
    process.env.SARVAM_API_KEY = "sarvam-key";
    process.env.GROQ_API_KEY = "gsk_groq";
    process.env.GEMINI_API_KEY = "";
    process.env.OPENAI_API_KEY = "";
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL) => {
      const url = String(u);
      seen.push(url);
      // Non-transient, so the chain moves on rather than retrying.
      if (url.includes("sarvam")) return new Response("forbidden", { status: 403 });
      return chatOk("from groq");
    }));
    const r = await generateText({ prompt: "hi", sql: null, preferProvider: "sarvam" });
    // The whole point: preferring a provider must not cost you the fallback.
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.provider).toBe("groq");
    expect(seen.some((u) => u.includes("groq"))).toBe(true);
  });

  it("changes nothing when no preference is given", async () => {
    process.env.SARVAM_API_KEY = "sarvam-key";
    process.env.GROQ_API_KEY = "gsk_groq";
    process.env.GEMINI_API_KEY = "";
    process.env.OPENAI_API_KEY = "";
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL) => { seen.push(String(u)); return chatOk("ok"); }));
    await generateText({ prompt: "hi", sql: null });
    // Groq is above Sarvam in the default order and must still be reached first.
    expect(seen[0]).toContain("groq");
  });

  it("ignores a preference for a provider with no key", async () => {
    process.env.SARVAM_API_KEY = "";
    process.env.GROQ_API_KEY = "gsk_groq";
    process.env.GEMINI_API_KEY = "";
    process.env.OPENAI_API_KEY = "";
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL) => { seen.push(String(u)); return chatOk("ok"); }));
    const r = await generateText({ prompt: "hi", sql: null, preferProvider: "sarvam" });
    expect(r.ok).toBe(true);
    expect(seen[0]).toContain("groq");
  });
});
