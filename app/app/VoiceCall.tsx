"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { encodeWav, rms, TARGET_RATE } from "@/lib/voice/wav";
import { workspaceId } from "@/lib/store";

// A voice call with the CMO, in the browser.
//
// Turn-taking without buttons: it listens, notices you started talking, notices you
// stopped (about a second of quiet), sends that turn, and speaks the answer. Talk over it
// and it stops to listen. Hang up and anything in flight is cancelled.
//
// Each turn is recorded in whatever the browser records in, then decoded and re-encoded as
// 16 kHz mono WAV before it leaves — the format the server's speech-to-text was verified
// with — so Chrome and Safari behave the same.

type Phase = "connecting" | "listening" | "hearing" | "thinking" | "speaking" | "error";
type Line = { who: "you" | "cmo"; text: string; sources?: { n: number; title: string; url: string }[] };
type Profile = { name?: string; oneLiner?: string; audience?: string };

const SPEECH_START = 0.035;     // RMS above which someone is talking
const BARGE_IN = 0.07;          // louder bar while the CMO is speaking, so its own voice can't trigger it
const END_SILENCE_MS = 1100;
const MAX_TURN_MS = 30_000;
const MIN_TURN_MS = 450;        // shorter is a cough or a click, not a question

const LABEL: Record<Phase, string> = {
  connecting: "Connecting…", listening: "Listening", hearing: "Go on, I'm listening",
  thinking: "Thinking…", speaking: "Speaking — talk to interrupt", error: "Something went wrong",
};

async function toWav(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const frames = Math.ceil(decoded.duration * TARGET_RATE);
    const off = new OfflineAudioContext(1, frames, TARGET_RATE);
    const src = off.createBufferSource();
    src.buffer = decoded; src.connect(off.destination); src.start();
    const rendered = await off.startRendering();
    return new Blob([encodeWav(rendered.getChannelData(0))], { type: "audio/wav" });
  } finally { ctx.close(); }
}

/**
 * An audio element unlocked by the tap that starts the call.
 *
 * Safari only lets an element play sound from a user gesture on it, and the CMO's first
 * reply arrives seconds after the tap — outside the gesture. Playing a moment of silence on
 * the element during the tap unlocks it; every reply then reuses the same element.
 */
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
export function unlockedPlayer(): HTMLAudioElement {
  const a = new Audio(SILENCE);
  a.play().catch(() => { /* not unlocked; replies will still show as text */ });
  return a;
}

export default function VoiceCall({ profile, player, onClose }: { profile: Profile; player?: HTMLAudioElement | null; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [lines, setLines] = useState<Line[]>([]);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const r = useRef({
    stream: null as MediaStream | null, ctx: null as AudioContext | null, analyser: null as AnalyserNode | null,
    rec: null as MediaRecorder | null, chunks: [] as Blob[], startedAt: 0, lastLoud: 0,
    audio: null as HTMLAudioElement | null, abort: null as AbortController | null, timer: 0 as ReturnType<typeof setInterval> | 0,
    phase: "connecting" as Phase, muted: false, history: [] as { role: "founder" | "cmo"; text: string }[], closed: false,
  });
  const go = useCallback((p: Phase) => { r.current.phase = p; setPhase(p); }, []);
  // The latest profile, read at send time. Held in a ref so the callbacks below never change
  // identity: the parent passes a fresh object every render, and if that reached the setup
  // effect's dependencies, every dashboard re-render would hang up and redial the call.
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const playerRef = useRef(player ?? null);

  const send = useCallback(async (blob: Blob) => {
    const s = r.current;
    go("thinking");
    s.abort = new AbortController();
    try {
      const form = new FormData();
      form.append("audio", await toWav(blob), "turn.wav");
      form.append("wsid", workspaceId());
      form.append("profile", JSON.stringify(profileRef.current));
      form.append("history", JSON.stringify(s.history));
      const res = await fetch("/api/voice/turn", { method: "POST", body: form, signal: s.abort.signal });
      const d = await res.json();
      if (s.closed) return;
      if (!res.ok) throw new Error(res.status === 429 ? "Too many turns too quickly — give it a moment." : "I didn't catch that. Try again.");
      if (!d.heard) { go("listening"); return; }
      s.history.push({ role: "founder", text: d.heard }, { role: "cmo", text: d.reply });
      setLines((l) => [...l, { who: "you", text: d.heard }, { who: "cmo", text: d.reply, sources: d.sources }]);
      if (d.audio) {
        const a = playerRef.current ?? new Audio();
        a.src = `data:audio/wav;base64,${d.audio}`;
        s.audio = a;
        a.onended = () => { if (r.current.phase === "speaking") go("listening"); };
        go("speaking");
        // If playback is refused the answer is still on screen; say so rather than sit silent.
        await a.play().catch(() => { setError("Couldn't play the answer aloud — it's written below."); go("listening"); });
      } else go("listening");
    } catch (e) {
      if (s.closed || (e instanceof DOMException && e.name === "AbortError")) return;
      setError(e instanceof Error ? e.message : "That didn't go through.");
      go("listening");
    }
  }, [go]);

  const startTurn = useCallback(() => {
    const s = r.current;
    if (!s.stream) return;
    s.chunks = [];
    const rec = new MediaRecorder(s.stream);
    rec.ondataavailable = (e) => { if (e.data.size) s.chunks.push(e.data); };
    rec.onstop = () => {
      const long = performance.now() - s.startedAt >= MIN_TURN_MS;
      if (long && s.chunks.length && !s.closed) send(new Blob(s.chunks, { type: rec.mimeType }));
      else if (!s.closed) go("listening");
    };
    s.rec = rec; s.startedAt = performance.now(); s.lastLoud = s.startedAt;
    rec.start(250);
    go("hearing");
  }, [go, send]);

  // The listening loop, every 50ms on a timer.
  //
  // Not requestAnimationFrame: browsers pause that in a background tab, so a founder who
  // switched tabs mid-call would be talking to something that had stopped listening. Timers
  // keep running there (throttled, but a call in a background tab is still a call).
  const loop = useCallback(() => {
    const s = r.current;
    if (s.closed || !s.analyser) return;
    const buf = new Uint8Array(s.analyser.fftSize);
    s.analyser.getByteTimeDomainData(buf);
    const level = s.muted ? 0 : rms(buf);
    const now = performance.now();

    if (s.phase === "listening" && level > SPEECH_START) startTurn();
    else if (s.phase === "hearing") {
      if (level > SPEECH_START) s.lastLoud = now;
      if (now - s.lastLoud > END_SILENCE_MS || now - s.startedAt > MAX_TURN_MS) s.rec?.stop();
    } else if (s.phase === "speaking" && level > BARGE_IN) {
      s.audio?.pause();
      startTurn();
    }
  }, [startTurn]);

  // Setup and teardown, owned per mount.
  //
  // React mounts twice in development (mount, clean up, mount) precisely to catch effects
  // that can't survive it — and this one couldn't: cleanup set `closed`, the second mount
  // never cleared it, and the listening loop returned on every tick, so the call sat on
  // "Listening" hearing nothing. Each mount now opens its own microphone and closes only
  // what it opened; a mount cleaned up before the microphone arrives releases it unused.
  useEffect(() => {
    const s = r.current;
    s.closed = false;
    let cancelled = false;
    let stream: MediaStream | null = null, ctx: AudioContext | null = null, timer: ReturnType<typeof setInterval> | 0 = 0;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        ctx = new AudioContext();
        // Created after awaiting microphone permission, an AudioContext can start suspended
        // (Safari does this readily), and a suspended one feeds the analyser silence.
        if (ctx.state === "suspended") await ctx.resume().catch(() => {});
        if (cancelled) return;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(stream).connect(analyser);
        Object.assign(s, { stream, ctx, analyser });
        go("listening");
        timer = setInterval(loop, 50);
        s.timer = timer;
      } catch {
        if (cancelled) return;
        setError("Populr needs your microphone for a call. Allow it in the browser's address bar and try again.");
        go("error");
      }
    })();
    return () => {
      cancelled = true;
      s.closed = true;
      if (timer) clearInterval(timer);
      s.abort?.abort();
      s.audio?.pause();
      if (s.rec?.state === "recording") s.rec.stop();
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close().catch(() => {});
    };
  }, [go, loop]);

  const toggleMute = () => { r.current.muted = !r.current.muted; setMuted(r.current.muted); };

  return (
    <div className="vc-overlay" role="dialog" aria-modal="true" aria-label="Call with your AI CMO">
      <div className="vc-card">
        <div className={"vc-orb " + phase} aria-hidden="true"><span /><span /><span /></div>
        <p className="vc-status" aria-live="polite">{muted ? "Muted" : LABEL[phase]}</p>
        {error && <p className="vc-error" role="alert">{error}</p>}

        <div className="vc-lines">
          {lines.length === 0 && phase !== "error" && (
            <p className="vc-hint">Ask anything about your marketing — or what&apos;s happening in your market this week. Speak in any Indian language.</p>
          )}
          {lines.map((l, i) => (
            <div key={i} className={"vc-line " + l.who}>
              <span className="vc-who">{l.who === "you" ? "You" : "CMO"}</span>
              <p>{l.text}</p>
              {l.sources && l.sources.length > 0 && (
                <ol className="vc-sources">
                  {l.sources.slice(0, 5).map((s) => <li key={s.n}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a></li>)}
                </ol>
              )}
            </div>
          ))}
        </div>

        <div className="vc-controls">
          <button className={"vc-btn" + (muted ? " on" : "")} onClick={toggleMute} disabled={phase === "error"} aria-pressed={muted}>
            {muted ? "Unmute" : "Mute"}
          </button>
          <button className="vc-btn end" onClick={onClose}>End call</button>
        </div>
      </div>
    </div>
  );
}
