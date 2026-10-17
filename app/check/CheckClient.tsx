"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// The interactive bits of /check: the form, re-running a check, and sharing a result.

async function runCheck(url: string): Promise<{ domain?: string; error?: string }> {
  const r = await fetch("/api/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return { error: d.message ?? "The check failed. Try again in a moment." };
  return { domain: d.result?.domain };
}

export function CheckForm({ initial = "", cta = "Check my site" }: { initial?: string; cta?: string }) {
  const router = useRouter();
  const [url, setUrl] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true); setError(null);
    const r = await runCheck(url.trim());
    if (r.domain) { router.push(`/check/${r.domain}`); return; }
    setBusy(false); setError(r.error ?? "The check failed.");
  };

  return (
    <form className="ck-form" onSubmit={submit}>
      <div className="ck-field">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="yourbusiness.com" aria-label="Website address" inputMode="url" autoComplete="url" spellCheck={false} disabled={busy} />
        <button type="submit" disabled={busy || !url.trim()}>{busy ? "Checking…" : cta}</button>
      </div>
      {busy && <p className="ck-hint" role="status">Reading the page, robots.txt, llms.txt and sitemap — about ten seconds.</p>}
      {error && <p className="ck-error" role="alert">{error}</p>}
    </form>
  );
}

export function RunCheck({ domain, label = "Run the check" }: { domain: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="ck-run">
      <button className="ck-btn" disabled={busy} onClick={async () => {
        setBusy(true); setError(null);
        const r = await runCheck(domain);
        if (r.domain) router.refresh(); else setError(r.error ?? "The check failed.");
        setBusy(false);
      }}>{busy ? "Checking…" : label}</button>
      {error && <p className="ck-error" role="alert">{error}</p>}
    </div>
  );
}

export function ShareBar({ domain, score }: { domain: string; score: number }) {
  const [copied, setCopied] = useState(false);
  const link = `https://www.trypopulr.in/check/${domain}`;
  const text = `${domain} scores ${score}/100 for SEO & AI readiness. Check yours free:`;
  const enc = encodeURIComponent;
  const targets = [
    { name: "X", href: `https://x.com/intent/post?text=${enc(text)}&url=${enc(link)}` },
    { name: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(link)}` },
    { name: "WhatsApp", href: `https://wa.me/?text=${enc(`${text} ${link}`)}` },
  ];
  return (
    <div className="ck-share" aria-label="Share this result">
      {targets.map((t) => <a key={t.name} href={t.href} target="_blank" rel="noopener noreferrer">{t.name}</a>)}
      <button onClick={() => navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); })}>{copied ? "Copied" : "Copy link"}</button>
    </div>
  );
}

export function CopySnippet({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="ck-snippet">
      <code>{code}</code>
      <button onClick={() => navigator.clipboard?.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); })}>{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}
