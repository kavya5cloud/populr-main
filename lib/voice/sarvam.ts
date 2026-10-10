// Speech in and out, through Sarvam.
//
// Chosen for Indian languages and accents, which is who Populr's founders are. Verified
// with live calls before this was written: speech-to-text (saarika:v2.5) transcribed a
// 16 kHz mono WAV exactly and detected en-IN on its own; text-to-speech returns WAV, and
// bulbul:v2 is retired — the API refuses it — so this uses bulbul:v3.
//
// Callers send WAV only. Browsers record in different containers (WebM in Chrome, MP4 in
// Safari), so the call screen converts each utterance to 16 kHz WAV before sending — one
// format, the one proven to work, rather than a guess about which codecs are accepted.

const BASE = "https://api.sarvam.ai";
const STT_MODEL = process.env.SARVAM_STT_MODEL || "saarika:v2.5";
const TTS_MODEL = process.env.SARVAM_TTS_MODEL || "bulbul:v3";

/** Languages the speech model can speak. Anything else is answered in English. */
const SPOKEN = new Set(["en-IN", "hi-IN", "bn-IN", "ta-IN", "te-IN", "kn-IN", "ml-IN", "mr-IN", "gu-IN", "pa-IN", "od-IN"]);

export class VoiceError extends Error {
  constructor(readonly stage: "stt" | "tts" | "config", message: string) { super(message); this.name = "VoiceError"; }
}

function key(): string {
  const k = process.env.SARVAM_API_KEY;
  if (!k) throw new VoiceError("config", "speech is not configured");
  return k;
}

export function voiceAvailable(): boolean {
  return Boolean(process.env.SARVAM_API_KEY);
}

/** Speech → text, with the language it was spoken in. */
export async function transcribe(wav: Blob, fetchImpl: typeof fetch = fetch): Promise<{ text: string; language: string }> {
  const form = new FormData();
  form.append("file", wav, "turn.wav");
  form.append("model", STT_MODEL);
  form.append("language_code", "unknown");   // detect it: founders switch languages mid-call
  const res = await fetchImpl(`${BASE}/speech-to-text`, {
    method: "POST", headers: { "api-subscription-key": key() }, body: form, signal: AbortSignal.timeout(20_000),
  });
  const j = await res.json().catch(() => ({})) as { transcript?: string; language_code?: string; error?: { message?: string } };
  if (!res.ok) throw new VoiceError("stt", j.error?.message ?? `HTTP ${res.status}`);
  return { text: (j.transcript ?? "").trim(), language: j.language_code || "en-IN" };
}

/** Text → speech, as base64 WAV, in the caller's language where the model speaks it. */
export async function speak(text: string, language: string, fetchImpl: typeof fetch = fetch): Promise<{ audio: string; language: string }> {
  const lang = SPOKEN.has(language) ? language : "en-IN";
  const res = await fetchImpl(`${BASE}/text-to-speech`, {
    method: "POST",
    headers: { "api-subscription-key": key(), "Content-Type": "application/json" },
    body: JSON.stringify({ text: text.slice(0, 1500), target_language_code: lang, model: TTS_MODEL }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = await res.json().catch(() => ({})) as { audios?: string[]; error?: { message?: string } };
  if (!res.ok || !j.audios?.[0]) throw new VoiceError("tts", j.error?.message ?? `HTTP ${res.status}`);
  return { audio: j.audios[0], language: lang };
}
