"use client";

import { useEffect, useMemo, useState } from "react";
import { approxWidth, DESCRIPTION, descriptionAdvice, fitToWidth, TITLE, titleAdvice, type Measure } from "@/lib/tools/serp";

// Measured with the real font in a canvas once the page is in the browser; until then (and
// if canvas is unavailable) with the per-character estimate.
function useMeasure(font: string, sizePx: number): Measure {
  const [ctx, setCtx] = useState<CanvasRenderingContext2D | null>(null);
  useEffect(() => {
    const c = document.createElement("canvas").getContext("2d");
    if (c) { c.font = font; setCtx(c); }
  }, [font]);
  return useMemo<Measure>(() => (ctx ? (t) => ctx.measureText(t).width : (t) => approxWidth(t, sizePx)), [ctx, sizePx]);
}

function displayUrl(raw: string): { site: string; crumbs: string } {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const parts = u.pathname.split("/").filter(Boolean).map((p) => decodeURIComponent(p).replace(/[-_]+/g, " "));
    return { site: u.hostname.replace(/^www\./, ""), crumbs: [u.origin.replace(/^https?:\/\//, "https://"), ...parts].join(" › ") };
  } catch {
    return { site: "yourbusiness.com", crumbs: "https://yourbusiness.com" };
  }
}

const Bar = ({ px, max }: { px: number; max: number }) => (
  <span className="tl-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, (px / max) * 100)}%` }} className={px > max ? "over" : ""} /></span>
);

export default function SerpPreview() {
  const [title, setTitle] = useState("Fresh Sourdough & Custom Cakes in Pune | Rao's Bakery");
  const [description, setDescription] = useState("Order sourdough, celebration cakes and pastries baked fresh every morning in Koregaon Park. Same-day pickup, delivery within 5 km.");
  const [link, setLink] = useState("raosbakery.in/menu");

  const mTitle = useMeasure(TITLE.font, TITLE.sizePx);
  const mDesc = useMeasure(DESCRIPTION.font, DESCRIPTION.sizePx);
  const t = fitToWidth(title || "No title", TITLE.maxPx, mTitle);
  const d = fitToWidth(description, DESCRIPTION.maxPx, mDesc);
  const url = displayUrl(link);

  return (
    <div className="tl-tool">
      <div className="tl-serp-wrap">
        <p className="tl-label">How it looks on Google (desktop)</p>
        <div className="tl-serp">
          <div className="tl-serp-site"><span className="tl-serp-fav" aria-hidden="true">{url.site[0]?.toUpperCase()}</span><span><b>{url.site}</b><small>{url.crumbs}</small></span></div>
          <p className="tl-serp-title">{t.shown}</p>
          {description.trim() ? <p className="tl-serp-desc">{d.shown}</p> : <p className="tl-serp-desc tl-dim">Google will pick a passage from the page.</p>}
        </div>
      </div>

      <div className="tl-form one tl-narrow">
        <label>Title <span className="tl-count">{title.length} chars · ~{Math.round(t.px)}px of {TITLE.maxPx}<Bar px={t.px} max={TITLE.maxPx} /></span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <ul className="tl-advice">{titleAdvice(title, t.px).map((a) => <li key={a.text} className={a.level}>{a.text}</li>)}</ul>
        <label>Meta description <span className="tl-count">{description.length} chars · ~{Math.round(d.px)}px of {DESCRIPTION.maxPx}<Bar px={d.px} max={DESCRIPTION.maxPx} /></span>
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <ul className="tl-advice">{descriptionAdvice(description, d.px).map((a) => <li key={a.text} className={a.level}>{a.text}</li>)}</ul>
        <label>Page address<input value={link} onChange={(e) => setLink(e.target.value)} inputMode="url" spellCheck={false} /></label>
        <p className="ck-hint">Google may still rewrite a title or description it thinks doesn&apos;t match the search — one that plainly describes the page is the one it keeps.</p>
      </div>
    </div>
  );
}
