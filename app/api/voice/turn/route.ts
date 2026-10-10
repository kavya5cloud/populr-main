import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { marketPlatform } from "@/lib/market/shared";
import { speak, transcribe, voiceAvailable, VoiceError } from "@/lib/voice/sarvam";
import { voiceAnswer, type VoiceBrand, type VoiceTurn } from "@/lib/voice/answer";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/voice/turn — one turn of a call with the CMO.
//
// In: the founder's utterance as 16 kHz WAV, plus the call so far. Out: what was heard, the
// reply as text and as audio, and any sources. One request per turn keeps it simple and
// lets the request's own abort signal cancel everything when the founder hangs up mid-answer.
//
// Nothing said on a call is logged.

const MAX_AUDIO_BYTES = 2_500_000;   // ~75s of 16 kHz mono; the call screen cuts turns at 30s

export async function GET() {
  return NextResponse.json({ ok: true, available: voiceAvailable() });
}

export async function POST(req: NextRequest) {
  if (!voiceAvailable()) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 40 : 12, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return NextResponse.json({ error: "no_audio" }, { status: 400 });
  if (audio.size > MAX_AUDIO_BYTES) return NextResponse.json({ error: "too_long" }, { status: 413 });

  const tenant = await workspaceKey(String(form.get("wsid") ?? ""));
  if (!tenant) return NextResponse.json({ error: "no_key" }, { status: 400 });

  const parse = <T,>(k: string, fallback: T): T => { try { return JSON.parse(String(form.get(k) ?? "")) as T; } catch { return fallback; } };
  const history = parse<VoiceTurn[]>("history", []).slice(-8).map((t) => ({ role: t.role === "cmo" ? "cmo" as const : "founder" as const, text: String(t.text ?? "").slice(0, 600) }));
  const b = parse<VoiceBrand>("profile", {});
  const brand: VoiceBrand = { name: b.name?.slice(0, 80), oneLiner: b.oneLiner?.slice(0, 300), audience: b.audience?.slice(0, 200) };

  try {
    const heard = await transcribe(audio);
    if (!heard.text) return NextResponse.json({ ok: true, heard: "", reply: "", audio: null, sources: [] });

    const answer = await voiceAnswer(
      { tenant, question: heard.text.slice(0, 800), language: heard.language, history, brand },
      { aggregator: marketPlatform().aggregator, signal: req.signal },
    );
    const spoken = await speak(answer.reply, heard.language);
    return NextResponse.json({ ok: true, heard: heard.text, language: spoken.language, reply: answer.reply, audio: spoken.audio, sources: answer.sources });
  } catch (e) {
    const stage = e instanceof VoiceError ? e.stage : "answer";
    console.warn(JSON.stringify({ event: "voice_turn_failed", stage, error: e instanceof Error ? e.message.slice(0, 160) : "unknown" }));
    return NextResponse.json({ error: "turn_failed", stage }, { status: 502 });
  }
}
