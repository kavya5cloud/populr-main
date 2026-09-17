import { describe, expect, it, vi, afterEach } from "vitest";
import { localize, mask, unmask, chunk } from "@/lib/content/localize";

// Translation is a separate capability from generation on purpose: it is not in the LLM
// fallback chain, because falling through from a translate call to a chat model would not
// degrade the operation, it would silently change what the operation is.

afterEach(() => { vi.unstubAllGlobals(); delete process.env.SARVAM_API_KEY; });

const ok = (translated: string) =>
  vi.fn(async () => new Response(JSON.stringify({ translated_text: translated, request_id: "r" }),
    { status: 200, headers: { "Content-Type": "application/json" } }));

describe("protected content survives a round trip", () => {
  it("hands back URLs, prices and handles untouched", () => {
    const src = "Visit https://acme.in/sale — ₹1,499 only. Ask @acme or hi@acme.in";
    const { masked, items } = mask(src);
    // The translator never sees them.
    expect(masked).not.toContain("https://acme.in/sale");
    expect(masked).not.toContain("₹1,499");
    // A translator that mangles everything still cannot damage them.
    expect(unmask(masked, items)).toBe(src);
  });

  it("protects brand vocabulary the caller names", () => {
    const { masked, items } = mask("Try Populr today", ["Populr"]);
    expect(masked).not.toContain("Populr");
    expect(unmask(masked, items)).toBe("Try Populr today");
  });

  it("keeps a markdown link whole rather than splitting it", () => {
    const src = "Read [our guide](https://acme.in/guide) first.";
    const { masked, items } = mask(src);
    expect(unmask(masked, items)).toBe(src);
    expect(items.some((i) => i.kind === "MDLINK")).toBe(true);
  });

  it("never leaves a token behind after restoring", () => {
    const src = "50% off at https://a.in — code `SAVE50`, ₹999";
    const { masked, items } = mask(src);
    expect(unmask(masked, items)).not.toMatch(/⦙/);
  });
});

describe("long copy is split on paragraphs, never mid-sentence", () => {
  it("keeps short text as one piece", () => {
    expect(chunk("short", 2000)).toEqual(["short"]);
  });

  it("splits on blank lines", () => {
    const parts = chunk(["a".repeat(900), "b".repeat(900), "c".repeat(900)].join("\n\n"), 2000);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(2000);
  });
});

describe("failures are returned, never thrown", () => {
  it("says so when no key is configured", async () => {
    const r = await localize("hello", "hi-IN");
    expect(r).toEqual({ ok: false, error: "not_configured" });
  });

  it("maps Sarvam's 403 to an auth failure, not a retry", async () => {
    process.env.SARVAM_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("forbidden", { status: 403 })));
    const r = await localize("hello", "hi-IN");
    expect(r).toEqual(expect.objectContaining({ ok: false, error: "auth_failed", status: 403 }));
  });

  it("names a rate limit as a rate limit", async () => {
    process.env.SARVAM_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("slow down", { status: 429 })));
    const r = await localize("hello", "hi-IN");
    expect(r).toEqual(expect.objectContaining({ ok: false, error: "rate_limited" }));
  });

  it("rejects a response that is not a translation", async () => {
    process.env.SARVAM_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const r = await localize("hello", "hi-IN");
    expect(r).toEqual({ ok: false, error: "unexpected_response" });
  });
});

describe("a successful translation", () => {
  it("returns the text with protected items restored", async () => {
    process.env.SARVAM_API_KEY = "test-key";
    // The stub returns the token untouched, which is what a correct translator does.
    vi.stubGlobal("fetch", ok("हमारी सेल देखें ⦙URL0⦙"));
    const r = await localize("See our sale https://acme.in", "hi-IN");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).toContain("https://acme.in");
      expect(r.text).not.toMatch(/⦙/);
      expect(r.protectedItems).toHaveLength(1);
    }
  });

  it("sends the language codes and never the key in the body", async () => {
    process.env.SARVAM_API_KEY = "secret-key";
    const f = ok("नमस्ते");
    vi.stubGlobal("fetch", f);
    await localize("hello", "mr-IN", { from: "en-IN" });
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.target_language_code).toBe("mr-IN");
    expect(body.source_language_code).toBe("en-IN");
    expect(JSON.stringify(body)).not.toContain("secret-key");
  });

  it("does nothing to empty input", async () => {
    process.env.SARVAM_API_KEY = "test-key";
    const r = await localize("   ", "hi-IN");
    expect(r.ok).toBe(true);
  });
});
