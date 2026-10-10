"use client";

import { useCallback, useEffect, useState } from "react";
import { workspaceId } from "@/lib/store";

// SEO autopilot, in the dashboard's SEO tab.
//
// The audit above lists what's wrong; this is where it gets fixed without touching code.
// Set up in order — details, questions, pages, then one line to paste — and every change to
// what a search engine sees passes through the founder's approval first.

type Fix = { title?: string; description?: string; status: "suggested" | "approved"; before?: { title: string | null; description: string | null } };
type Business = {
  type: string; name: string; description?: string; telephone?: string; email?: string; logo?: string;
  address?: { street?: string; locality?: string; region?: string; postalCode?: string; country?: string };
  openingHours?: string[]; sameAs?: string[];
};
type Cfg = {
  configured: true; site: string; enabled: boolean; business: Business | null; faq: { q: string; a: string }[];
  pages: Record<string, Fix>; seen: { count: number; lastAt: number | null; paths: string[] }; tag: string;
};

const TYPES: [string, string][] = [["LocalBusiness", "Local business"], ["Store", "Shop"], ["Restaurant", "Restaurant / café"], ["ProfessionalService", "Professional service"], ["Organization", "Company / online brand"]];
const emptyBiz: Business = { type: "LocalBusiness", name: "", address: {} };

function ago(t: number | null) {
  if (!t) return "never";
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}

export default function SeoAutopilot({ url }: { url: string }) {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [biz, setBiz] = useState<Business>(emptyBiz);
  const [faq, setFaq] = useState<{ q: string; a: string }[]>([]);
  const [path, setPath] = useState("/");
  const [edits, setEdits] = useState<Record<string, { title: string; description: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const take = useCallback((d: Cfg | { configured: false }) => {
    if (!d.configured) { setCfg(null); return; }
    setCfg(d);
    setBiz(d.business ?? { ...emptyBiz, name: "" });
    setFaq(d.faq.length ? d.faq : []);
    setEdits(Object.fromEntries(Object.entries(d.pages).map(([p, f]) => [p, { title: f.title ?? "", description: f.description ?? "" }])));
  }, []);

  useEffect(() => {
    fetch(`/api/seo/autopilot?wsid=${encodeURIComponent(workspaceId())}`, { cache: "no-store" })
      .then((r) => r.json()).then((d) => { if (d?.ok) take(d); }).catch(() => {}).finally(() => setLoaded(true));
  }, [take]);

  const call = async (label: string, method: string, body?: object, query = "") => {
    setBusy(label); setNote(null);
    try {
      const r = await fetch(`/api/seo/autopilot${query}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify({ wsid: workspaceId(), ...body }) : undefined });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setNote(d.detail || "That didn't go through. Try again."); return false; }
      take(d);
      return true;
    } finally { setBusy(null); }
  };

  if (!loaded) return null;

  if (!cfg) {
    return (
      <section className="ap-card">
        <div className="ap-head"><h3>SEO autopilot</h3><span className="ap-pill">Not set up</span></div>
        <p className="ap-lede">Fix what the audit finds without touching your site&apos;s code. Paste one line once; Populr applies the fixes you approve — details Google shows about your business, and better titles and descriptions for each page.</p>
        <button className="ap-primary" disabled={!!busy} onClick={() => call("start", "PUT", { site: url })}>{busy ? "Setting up…" : `Set up for ${url.replace(/^https?:\/\//, "").replace(/\/$/, "")}`}</button>
        {note && <p className="ap-note">{note}</p>}
      </section>
    );
  }

  const installed = cfg.seen.count > 0;
  const setAddr = (k: keyof NonNullable<Business["address"]>, v: string) => setBiz({ ...biz, address: { ...biz.address, [k]: v } });

  return (
    <section className="ap-card">
      <div className="ap-head">
        <h3>SEO autopilot</h3>
        <span className={"ap-pill " + (cfg.enabled ? (installed ? "on" : "wait") : "")}>
          {!cfg.enabled ? "Off" : installed ? `Active on ${cfg.seen.paths.length} page${cfg.seen.paths.length === 1 ? "" : "s"}` : "Waiting for install"}
        </span>
        <label className="ap-switch">
          <input type="checkbox" checked={cfg.enabled} disabled={!!busy || (!cfg.enabled && !cfg.business)} onChange={(e) => call("toggle", "PUT", { enabled: e.target.checked })} />
          <span>{cfg.enabled ? "On" : "Off"}</span>
        </label>
      </div>
      {!cfg.business && <p className="ap-hint">Add your business details first — that&apos;s what it will tell Google.</p>}

      <details className="ap-step" open={!cfg.business}>
        <summary><b>1</b> Your business, as Google should know it</summary>
        <div className="ap-grid">
          <label>Type<select value={biz.type} onChange={(e) => setBiz({ ...biz, type: e.target.value })}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label>Name<input value={biz.name} onChange={(e) => setBiz({ ...biz, name: e.target.value })} /></label>
          <label className="wide">What you do, in one or two sentences<textarea rows={2} value={biz.description ?? ""} onChange={(e) => setBiz({ ...biz, description: e.target.value })} /></label>
          <label>Phone<input value={biz.telephone ?? ""} onChange={(e) => setBiz({ ...biz, telephone: e.target.value })} placeholder="+91 98765 43210" /></label>
          <label>Email<input value={biz.email ?? ""} onChange={(e) => setBiz({ ...biz, email: e.target.value })} /></label>
          <label className="wide">Street address<input value={biz.address?.street ?? ""} onChange={(e) => setAddr("street", e.target.value)} /></label>
          <label>City<input value={biz.address?.locality ?? ""} onChange={(e) => setAddr("locality", e.target.value)} /></label>
          <label>State<input value={biz.address?.region ?? ""} onChange={(e) => setAddr("region", e.target.value)} /></label>
          <label>PIN code<input value={biz.address?.postalCode ?? ""} onChange={(e) => setAddr("postalCode", e.target.value)} /></label>
          <label>Country<input value={biz.address?.country ?? ""} onChange={(e) => setAddr("country", e.target.value)} placeholder="IN" /></label>
          <label className="wide">Opening hours, one per line<textarea rows={2} value={(biz.openingHours ?? []).join("\n")} onChange={(e) => setBiz({ ...biz, openingHours: e.target.value.split("\n") })} placeholder={"Mo-Sa 09:00-21:00\nSu 10:00-14:00"} /></label>
          <label className="wide">Your profiles elsewhere, one link per line<textarea rows={2} value={(biz.sameAs ?? []).join("\n")} onChange={(e) => setBiz({ ...biz, sameAs: e.target.value.split("\n") })} placeholder={"https://instagram.com/yourshop\nhttps://maps.google.com/…"} /></label>
        </div>
        <button className="ap-secondary" disabled={!!busy || !biz.name.trim()} onClick={() => call("biz", "PUT", { business: { ...biz, openingHours: biz.openingHours?.map((s) => s.trim()).filter(Boolean), sameAs: biz.sameAs?.map((s) => s.trim()).filter(Boolean) } })}>{busy === "biz" ? "Saving…" : "Save details"}</button>
      </details>

      <details className="ap-step">
        <summary><b>2</b> Questions customers ask <em>(optional)</em></summary>
        <p className="ap-hint">These can show under your homepage in search results. Answer them as you would in person.</p>
        {faq.map((f, i) => (
          <div key={i} className="ap-faq">
            <input placeholder="Question" value={f.q} onChange={(e) => setFaq(faq.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))} />
            <textarea rows={2} placeholder="Answer" value={f.a} onChange={(e) => setFaq(faq.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))} />
            <button className="ap-link" onClick={() => setFaq(faq.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <div className="ap-row">
          {faq.length < 10 && <button className="ap-link" onClick={() => setFaq([...faq, { q: "", a: "" }])}>+ Add a question</button>}
          <button className="ap-secondary" disabled={!!busy} onClick={() => call("faq", "PUT", { faq })}>{busy === "faq" ? "Saving…" : "Save questions"}</button>
        </div>
      </details>

      <details className="ap-step">
        <summary><b>3</b> Page titles and descriptions</summary>
        <p className="ap-hint">Populr reads the page and drafts a title and description from what&apos;s on it. Edit freely; nothing changes on your site until you approve.</p>
        <div className="ap-row">
          <input className="ap-path" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/about" aria-label="Page path" />
          <button className="ap-secondary" disabled={!!busy} onClick={() => call("suggest", "POST", { path })}>{busy === "suggest" ? "Reading the page…" : "Draft a fix"}</button>
        </div>
        {Object.entries(cfg.pages).map(([p, f]) => (
          <div key={p} className={"ap-page " + f.status}>
            <div className="ap-page-head"><code>{p}</code><span className={"ap-pill " + (f.status === "approved" ? "on" : "wait")}>{f.status === "approved" ? "Live" : "Waiting for you"}</span></div>
            {f.before && <p className="ap-before">Now: <s>{f.before.title ?? "no title"}</s></p>}
            <label>Title <small>{(edits[p]?.title ?? "").length}/60</small><input value={edits[p]?.title ?? ""} onChange={(e) => setEdits({ ...edits, [p]: { ...edits[p], title: e.target.value } })} /></label>
            <label>Description <small>{(edits[p]?.description ?? "").length}/158</small><textarea rows={2} value={edits[p]?.description ?? ""} onChange={(e) => setEdits({ ...edits, [p]: { ...edits[p], description: e.target.value } })} /></label>
            <div className="ap-row">
              <button className="ap-primary" disabled={!!busy} onClick={() => call("approve", "PATCH", { path: p, ...edits[p] })}>{f.status === "approved" ? "Update" : "Approve"}</button>
              <button className="ap-link" disabled={!!busy} onClick={() => call("drop", "DELETE", undefined, `?wsid=${encodeURIComponent(workspaceId())}&path=${encodeURIComponent(p)}`)}>Remove</button>
            </div>
          </div>
        ))}
      </details>

      <details className="ap-step" open={!!cfg.business && !installed}>
        <summary><b>4</b> Paste this on your site, once</summary>
        <div className="ap-tag"><code>{cfg.tag}</code><button className="ap-secondary" onClick={() => navigator.clipboard?.writeText(cfg.tag).then(() => setNote("Copied."))}>Copy</button></div>
        <p className="ap-hint">Put it in the &lt;head&gt; of every page. On Wix, Shopify, WordPress or Squarespace it goes in Settings → Custom code (or “header scripts”).</p>
        <p className="ap-hint">{installed ? `Seen running ${ago(cfg.seen.lastAt)}, on ${cfg.seen.paths.slice(0, 5).join(", ")}${cfg.seen.paths.length > 5 ? "…" : ""}.` : "Not seen yet — it shows here the first time someone opens a page with it."}</p>
        <p className="ap-fine">Google reads everything this applies. Some other search engines and link previews only read the page as first served, so they may still show the old title.</p>
      </details>

      {note && <p className="ap-note" role="status">{note}</p>}
    </section>
  );
}
