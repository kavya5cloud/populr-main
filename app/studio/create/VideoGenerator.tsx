"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { workspaceId } from "@/lib/store";
import { DEFAULT_LANGUAGE, localeLabel, type LanguageCode } from "@/lib/i18n/languages";
import { briefFromWorkspace, type WorkspaceProfile } from "@/lib/creative/studio-brief";

// The one real media path in Studio.
//
// Every stage shown here is a state the backend actually reported. There is no timer, no
// simulated sequence and no optimistic "almost done" — the labels below are a direct
// translation of creative_jobs.status, and if the backend has nothing new to say the screen
// does not either. That is why the list is short and uneven: the real lifecycle is one long
// wait followed by four fast steps, and pretending otherwise was the thing Phase 8 removed.
//
// The player is not rendered until a stored, validated asset exists. The API only returns
// an assetId when isReady() is true, so there is no state in which this component could
// show a video that is not there.

type Status =
  | "queued" | "preparing" | "submitted" | "running"
  | "downloading" | "validating" | "ready" | "failed" | "cancelled";

/** Only states the backend genuinely reports. Nothing here is invented for pacing. */
const LABEL: Record<Status, string> = {
  queued: "Queued",
  preparing: "Preparing",
  submitted: "Sent to the renderer",
  running: "Generating",
  downloading: "Retrieving the file",
  validating: "Checking the file",
  ready: "Ready",
  failed: "Failed",
  cancelled: "Cancelled",
};

const DONE: Status[] = ["ready", "failed", "cancelled"];

type Shot = {
  n: number; startSec: number; durationSec: number;
  description: string; camera: string; onScreenText: string | null;
};
type Preview = {
  logline: string; tone: string; audience: string; cta: string;
  durationSec: number; aspectRatio: string; storyboard: Shot[];
};

export default function VideoGenerator({ prompt, language = DEFAULT_LANGUAGE, profile = null }: {
  prompt: string;
  language?: LanguageCode;
  /** The analysed business, passed down from Studio. Absent for a new workspace. */
  profile?: WorkspaceProfile | null;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Bumped by Regenerate. It becomes the idempotency nonce, so a deliberate second take is
  // a genuinely new generation while a double click is not.
  const nonce = useRef<string>("take-1");

  // The request is the objective; everything the video actually *says* comes from the
  // workspace profile. Sending the request as keyMessage too — which is what this used to
  // do — is what put the instruction on screen as a caption.
  const brief = useCallback(() => briefFromWorkspace(prompt, profile), [prompt, profile]);

  // The storyboard, shown before anything is spent.
  //
  // This calls the same prepareCreative() the generate route calls, so what is on screen is
  // what the provider will be told — there is no second storyboard built for display. Free
  // and deterministic: no model call, no provider call, no job.
  useEffect(() => {
    let live = true;
    fetch("/api/creative/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetKind: "hero_video", brief: brief(), durationSec: 10, aspectRatio: "9:16", language, profile }),
    })
      .then((r) => r.json())
      .then((d) => { if (live && d?.ok) setPreview(d as Preview); })
      .catch(() => {});
    return () => { live = false; };
  }, [brief, language, profile]);

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/creative/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wsid: workspaceId(),
          assetKind: "hero_video",
          brief: brief(),
          durationSec: 10,
          aspectRatio: "9:16",
          language,
          profile,
          nonce: nonce.current,
        }),
      });
      const d = await r.json();
      if (!r.ok || d.error) {
        setError(
          d.error === "generation_unavailable" ? "Video generation is not switched on yet."
          : d.error === "storage_unavailable" ? "Video storage is not configured yet."
          : d.detail || d.error || "Could not start.",
        );
        return;
      }
      setJobId(d.id);
      setStatus(d.status as Status);
      setAssetId(null);
    } catch {
      setError("Could not reach Populr.");
    } finally {
      setBusy(false);
    }
  }, [brief, language, profile]);

  // Poll while the job is live. Stops the moment it reaches a terminal state — a finished
  // job is not asked about again.
  useEffect(() => {
    if (!jobId || (status && DONE.includes(status))) return;
    const t = setInterval(async () => {
      try {
        const d = await fetch(`/api/creative/${jobId}?wsid=${encodeURIComponent(workspaceId())}`, { cache: "no-store" })
          .then((r) => r.json());
        if (!d?.ok) return;
        setStatus(d.status as Status);
        setAssetId(d.assetId ?? null);
        if (d.error) setError(d.error);
      } catch { /* a missed poll is not a failure; the next one will say */ }
    }, 5000);
    return () => clearInterval(t);
  }, [jobId, status]);

  function regenerate() {
    nonce.current = `take-${Date.now().toString(36)}`;
    setJobId(null);
    setStatus(null);
    setAssetId(null);
    void start();
  }

  const src = assetId ? `/api/creative/assets/${assetId}?wsid=${encodeURIComponent(workspaceId())}` : null;

  return (
    <section className="cv">
      <h3 className="cv-h">Turn this into a video</h3>
      <p className="cv-sub">
        Populr writes the shots below and a renderer draws them. Ten seconds, vertical, no
        sound — the voiceover in your script is for you to record.
      </p>

      {/* The brief, so what Populr decided is readable before it is bought. */}
      {preview && (
        <div className="cv-brief">
          {preview.logline && <p className="cv-logline">{preview.logline}</p>}
          <p className="cv-brief-m">
            {preview.durationSec}s · {preview.aspectRatio} · {preview.tone} · for {preview.audience}
            {" · "}{localeLabel(language)}
          </p>
        </div>
      )}

      {preview && preview.storyboard.length > 0 && (
        <ol className="cv-shots">
          {preview.storyboard.map((s) => (
            <li key={s.n}>
              <span className="cv-shot-n">{String(s.n).padStart(2, "0")}</span>
              <span className="cv-shot-d">
                {s.description}
                {s.onScreenText && <em className="cv-shot-t">&ldquo;{s.onScreenText}&rdquo;</em>}
              </span>
              <span className="cv-shot-m">{s.startSec}–{s.startSec + s.durationSec}s · {s.camera}</span>
            </li>
          ))}
        </ol>
      )}

      {!jobId && (
        <button className="cv-go" onClick={start} disabled={busy || !prompt.trim() || !preview}>
          {busy ? "Starting…" : "Generate video"}
        </button>
      )}

      {status && status !== "ready" && status !== "failed" && (
        <p className="cv-status" aria-live="polite">
          {LABEL[status]}
          {/* Said out loud rather than implied by a bar that would have to be invented. */}
          <span className="cv-status-note">This takes a few minutes. You can leave this page.</span>
        </p>
      )}

      {status === "failed" && (
        <div className="cv-fail" role="alert">
          <p>That generation did not finish, and nothing was produced.</p>
          {error && <code className="cv-code">{error}</code>}
          <button className="cv-go" onClick={regenerate}>Try again</button>
        </div>
      )}

      {/* Only ever rendered when a stored, validated asset exists. */}
      {status === "ready" && src && (
        <div className="cv-out">
          <video className="cv-video" src={src} controls playsInline preload="metadata" />
          <div className="cv-meta">MP4 · 9:16 · 10s</div>
          <div className="cv-actions">
            <a className="cv-dl" href={src} download>Download</a>
            <button className="cv-go cv-again" onClick={regenerate}>Regenerate</button>
          </div>
        </div>
      )}
    </section>
  );
}
