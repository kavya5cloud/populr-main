"use client";

import { useEffect, useState } from "react";

// The interactive pieces of the developer pages: copyable code, the per-editor install tabs,
// and the example session in the hero. Everything else on those pages is server-rendered.

export function CopyBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    // The button sits in a header bar above the code, not over it: floated on top, a long
    // command ran underneath it and the button covered the part people needed to read.
    <div className="dv-code">
      <div className="dv-code-head">
        <span className="dv-code-label">{label ?? ""}</span>
        <button type="button" className="dv-copybtn" onClick={() => navigator.clipboard?.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); })}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

export type InstallTab = { id: string; name: string; where: string; code: string; note?: string };

export function InstallTabs({ tabs }: { tabs: InstallTab[] }) {
  const [active, setActive] = useState(tabs[0].id);
  const t = tabs.find((x) => x.id === active) ?? tabs[0];
  return (
    <div className="dv-tabs">
      <div className="dv-tablist" role="tablist" aria-label="Your editor">
        {tabs.map((x) => (
          <button key={x.id} role="tab" aria-selected={x.id === active} className={x.id === active ? "on" : ""} onClick={() => setActive(x.id)}>{x.name}</button>
        ))}
      </div>
      <div role="tabpanel" className="dv-tabpanel">
        <p className="dv-where">{t.where}</p>
        <CopyBlock code={t.code} />
        {t.note && <p className="dv-tabnote">{t.note}</p>}
      </div>
    </div>
  );
}

// The hero's example session, played line by line. Example data, labelled as such.
type Line = { k: "prompt" | "tool" | "out" | "edit-" | "edit+" | "ok" | "file"; t: string };
const SESSION: Line[] = [
  { k: "prompt", t: "apply my Populr SEO fixes" },
  { k: "tool", t: "populr · seo_status" },
  { k: "out", t: "kiranaexpress.in — 2 pages with approved fixes" },
  { k: "tool", t: "populr · get_seo_fixes" },
  { k: "out", t: "/ and /delivery: title, description, JSON-LD" },
  { k: "file", t: "Edit  app/layout.tsx" },
  { k: "edit-", t: 'title: "Home",' },
  { k: "edit+", t: 'title: "Fresh groceries in 30 minutes | Kirana Express",' },
  { k: "edit+", t: 'description: "Order from your neighbourhood store in Pune…",' },
  { k: "edit+", t: "<script type=\"application/ld+json\"> Store, WebSite, FAQPage" },
  { k: "file", t: "Edit  app/delivery/page.tsx" },
  { k: "edit+", t: 'title: "Same-day delivery across Pune | Kirana Express",' },
  { k: "tool", t: "populr · verify_page kiranaexpress.in" },
  { k: "ok", t: "✓ title  ✓ description  ✓ Store  ✓ WebSite  ✓ FAQPage" },
];

export function SessionDemo() {
  const [n, setN] = useState(SESSION.length);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setN(0);
    let i = 0;
    const id = setInterval(() => {
      i = i >= SESSION.length + 6 ? 0 : i + 1;   // hold the finished session briefly, then replay
      setN(Math.min(i, SESSION.length));
    }, 650);
    return () => clearInterval(id);
  }, []);
  return (
    <figure className="dv-term" aria-label="An example session: a coding assistant applying Populr's SEO fixes and verifying them">
      <div className="dv-term-bar" aria-hidden="true"><i /><i /><i /><span>claude — kiranaexpress</span></div>
      <div className="dv-term-body" aria-hidden="true">
        {SESSION.slice(0, n).map((l, i) => (
          <div key={i} className={`dv-l dv-${l.k}`}>
            {l.k === "prompt" ? <><span className="dv-caret">&gt;</span> {l.t}</> : l.k === "tool" ? <><span className="dv-dot">●</span> {l.t}</> : l.k === "edit-" ? <>- {l.t}</> : l.k === "edit+" ? <>+ {l.t}</> : l.t}
          </div>
        ))}
        {n < SESSION.length && <span className="dv-cursor" />}
      </div>
      <figcaption className="dv-term-cap">Example session · illustrative data</figcaption>
    </figure>
  );
}
