"use client";

import { useState } from "react";

export default function LlmsGenerator() {
  const [site, setSite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [out, setOut] = useState<{ origin: string; content: string; pages: number; source: "sitemap" | "links" } | null>(null);
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!site.trim() || busy) return;
    setBusy(true); setError(null); setCopied(false);
    const r = await fetch("/api/tools/llms-txt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: site.trim() }) }).catch(() => null);
    const d = await r?.json().catch(() => ({}));
    setBusy(false);
    if (!r?.ok) { setError(d?.message ?? "Generating failed. Try again in a moment."); return; }
    setOut(d); setText(d.content);
  };

  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    a.download = "llms.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="tl-tool">
      <form className="ck-form" onSubmit={run}>
        <div className="ck-field">
          <input value={site} onChange={(e) => setSite(e.target.value)} placeholder="yourbusiness.com" aria-label="Website address" inputMode="url" autoComplete="url" spellCheck={false} disabled={busy} />
          <button type="submit" disabled={busy || !site.trim()}>{busy ? "Reading your site…" : "Generate llms.txt"}</button>
        </div>
        {busy && <p className="ck-hint" role="status">Reading your sitemap and up to twenty pages — about fifteen seconds.</p>}
        {error && <p className="ck-error" role="alert">{error}</p>}
      </form>

      {out && (
        <div className="tl-result" aria-live="polite">
          <p className="tl-verdict good">
            Built from {out.source === "sitemap" ? "your sitemap" : "the links on your home page (we couldn't find a sitemap)"} — {out.pages} page{out.pages === 1 ? "" : "s"}, each described in its own title and meta description. Edit anything below before you save it.
          </p>
          <textarea className="tl-editor" value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(28, text.split("\n").length + 2)} spellCheck={false} aria-label="Your llms.txt" />
          <div className="tl-actions">
            <button className="ck-btn" onClick={() => navigator.clipboard?.writeText(text).then(() => setCopied(true))}>{copied ? "Copied" : "Copy"}</button>
            <button className="ck-btn tl-light" onClick={download}>Download llms.txt</button>
          </div>
          <p className="ck-hint">Save it at the root of your site, so it&apos;s served at <code>{out.origin}/llms.txt</code> — in most frameworks that means <code>public/llms.txt</code>.</p>
        </div>
      )}
    </div>
  );
}
