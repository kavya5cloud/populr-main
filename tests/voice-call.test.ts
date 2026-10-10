import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { encodeWav, rms } from "@/lib/voice/wav";
import { forSpeech } from "@/lib/voice/answer";
import { speak, transcribe } from "@/lib/voice/sarvam";

// Calls with the CMO. Verified live against Sarvam before these were written: a 16 kHz WAV
// transcribed exactly, and bulbul:v2 is refused as retired. These pin the parts that can
// break without a network: the audio format, what gets read aloud, and the route's guards.

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); vi.doUnmock("@/lib/auth"); });

describe("the audio that leaves the browser", () => {
  it("is a valid 16 kHz mono 16-bit WAV", () => {
    const wav = new DataView(encodeWav(new Float32Array([0, 0.5, -0.5, 1, -1])));
    const tag = (o: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => wav.getUint8(o + i)));
    expect(tag(0)).toBe("RIFF");
    expect(tag(8)).toBe("WAVE");
    expect(wav.getUint16(22, true)).toBe(1);        // mono
    expect(wav.getUint32(24, true)).toBe(16_000);   // sample rate
    expect(wav.getUint16(34, true)).toBe(16);       // bits
    expect(wav.getUint32(40, true)).toBe(10);       // 5 samples × 2 bytes
    expect(wav.getInt16(44 + 3 * 2, true)).toBe(32767);
    expect(wav.getInt16(44 + 4 * 2, true)).toBe(-32768);
  });

  it("measures loudness the silence detector can threshold", () => {
    expect(rms(new Uint8Array(512).fill(128))).toBe(0);
    expect(rms(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5);
  });
});

describe("what gets read aloud", () => {
  it("drops citation markers, markdown, bullets and links", () => {
    expect(forSpeech("Dark stores are expanding [1][2]. **Act now**:\n- post daily\nSee https://x.com/a")).toBe("Dark stores are expanding. Act now: post daily See");
  });
});

describe("speech through Sarvam", () => {
  it("asks for language detection and returns what it heard", async () => {
    vi.stubEnv("SARVAM_API_KEY", "k");
    let sent: FormData | null = null;
    const f = vi.fn(async (_u: string, init?: RequestInit) => { sent = init?.body as FormData; return new Response(JSON.stringify({ transcript: " hello ", language_code: "hi-IN" })); });
    expect(await transcribe(new Blob(["x"]), f as unknown as typeof fetch)).toEqual({ text: "hello", language: "hi-IN" });
    expect(sent!.get("language_code")).toBe("unknown");
  });

  it("speaks with the current model, and falls back to English for a language it can't speak", async () => {
    vi.stubEnv("SARVAM_API_KEY", "k");
    let body: Record<string, unknown> = {};
    const f = vi.fn(async (_u: string, init?: RequestInit) => { body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ audios: ["UklGRg=="] })); });
    expect((await speak("hi", "fr-FR", f as unknown as typeof fetch)).language).toBe("en-IN");
    // bulbul:v2 is retired — the live API refuses it.
    expect(body.model).toBe("bulbul:v3");
  });
});

describe("POST /api/voice/turn", () => {
  it("says so when speech isn't configured, rather than failing mid-call", async () => {
    vi.stubEnv("SARVAM_API_KEY", "");
    const { GET, POST } = await import("@/app/api/voice/turn/route");
    expect(await (await GET()).json()).toEqual({ ok: true, available: false });
    expect((await POST(new NextRequest("http://x/api/voice/turn", { method: "POST" }))).status).toBe(503);
  });

  it("refuses an oversized turn before sending it anywhere", async () => {
    vi.doMock("@/lib/auth", () => ({ getSession: async () => null }));
    vi.stubEnv("SARVAM_API_KEY", "k");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const { POST } = await import("@/app/api/voice/turn/route");
    const form = new FormData();
    form.append("audio", new Blob([new Uint8Array(2_600_000)]), "turn.wav");
    form.append("wsid", "ws1");
    expect((await POST(new NextRequest("http://x/api/voice/turn", { method: "POST", body: form }))).status).toBe(413);
    expect(f).not.toHaveBeenCalled();
  });

  it("returns nothing to say for silence, without asking the model", async () => {
    vi.doMock("@/lib/auth", () => ({ getSession: async () => null }));
    vi.stubEnv("SARVAM_API_KEY", "k");
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => { calls.push(String(u)); return new Response(JSON.stringify({ transcript: "", language_code: "en-IN" })); }));
    const { POST } = await import("@/app/api/voice/turn/route");
    const form = new FormData();
    form.append("audio", new Blob([new Uint8Array(100)]), "turn.wav");
    form.append("wsid", "ws1");
    const d = await (await POST(new NextRequest("http://x/api/voice/turn", { method: "POST", body: form }))).json();
    expect(d).toMatchObject({ ok: true, heard: "", reply: "" });
    expect(calls).toEqual(["https://api.sarvam.ai/speech-to-text"]);
  });
});
