"use client";

import { useState } from "react";
import type { ImageInfo, PreviewCheck, PreviewMeta } from "@/lib/tools/link-preview";

// The page and its share image are read on our server; the image itself is shown straight
// from the site (this page's policy allows https images), with no referrer sent.

type Result = { meta: PreviewMeta; image: ImageInfo | null; checks: PreviewCheck[] };
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

function Img({ src, className }: { src: string | null; className: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <div className={className + " lp-noimg"}>No image</div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className={className} referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
}

function Cards({ r }: { r: Result }) {
  const { meta } = r;
  const domain = host(meta.url);
  const okImage = !!meta.image && !!r.image && r.image.status === 200 && r.image.type.startsWith("image/") && !/svg/.test(r.image.type);
  const image = okImage ? meta.image : null;
  const title = meta.title ?? meta.url;
  return (
    <div className="lp-cards">
      <figure className="lp-card lp-wa">
        <figcaption>WhatsApp</figcaption>
        <div className="lp-wa-bubble">
          <div className="lp-wa-preview">
            {image && <Img src={image} className="lp-wa-img" />}
            <div className="lp-wa-text"><b>{title}</b>{meta.description && <span>{meta.description}</span>}<small>{domain}</small></div>
          </div>
          <p className="lp-wa-link">{meta.url}</p>
        </div>
      </figure>
      <figure className="lp-card lp-li">
        <figcaption>LinkedIn</figcaption>
        <div className="lp-li-box">
          <Img src={image} className="lp-li-img" />
          <div className="lp-li-text"><b>{title}</b><small>{domain}</small></div>
        </div>
      </figure>
      <figure className="lp-card lp-x">
        <figcaption>X</figcaption>
        {meta.twitterCard === "summary" || !image ? (
          <div className="lp-x-small"><Img src={image} className="lp-x-thumb" /><div><small>{domain}</small><b>{title}</b>{meta.description && <span>{meta.description}</span>}</div></div>
        ) : (
          <div className="lp-x-large"><Img src={image} className="lp-x-img" /><span className="lp-x-domain">{domain}</span></div>
        )}
      </figure>
      <figure className="lp-card lp-sl">
        <figcaption>Slack</figcaption>
        <div className="lp-sl-box">
          <small>{meta.favicon && <Img src={meta.favicon} className="lp-sl-fav" />}{meta.siteName ?? domain}</small>
          <b>{title}</b>
          {meta.description && <span>{meta.description}</span>}
          {image && <Img src={image} className="lp-sl-img" />}
        </div>
      </figure>
    </div>
  );
}

export default function PreviewChecker() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<Result | null>(null);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true); setError(null);
    const r = await fetch(`/api/tools/preview?url=${encodeURIComponent(url.trim())}`).catch(() => null);
    const d = await r?.json().catch(() => ({}));
    setBusy(false);
    if (!r?.ok) { setError(d?.message ?? "The check failed. Try again in a moment."); return; }
    setRes(d);
  };

  const problems = res?.checks.filter((c) => c.level !== "good") ?? [];
  return (
    <div className="tl-tool">
      <form className="ck-form" onSubmit={run}>
        <div className="ck-field">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="yourbusiness.com/menu" aria-label="Page address" inputMode="url" autoComplete="url" spellCheck={false} disabled={busy} />
          <button type="submit" disabled={busy || !url.trim()}>{busy ? "Checking…" : "Check preview"}</button>
        </div>
        {error && <p className="ck-error" role="alert">{error}</p>}
      </form>
      {res && (
        <div className="tl-result" aria-live="polite">
          <p className={"tl-verdict " + (problems.some((c) => c.level === "bad") ? "bad" : "good")}>
            {problems.length ? `${problems.length} thing${problems.length === 1 ? "" : "s"} to fix for ${host(res.meta.url)}.` : `${host(res.meta.url)} has everything apps need for a good preview.`}
          </p>
          <Cards r={res} />
          <ul className="tl-advice lp-checks">
            {res.checks.map((c) => <li key={c.id} className={c.level === "good" ? "" : c.level}><b>{c.label}:</b> {c.detail}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
