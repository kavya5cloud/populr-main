"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { workspaceId } from "@/lib/store";
import { installTabs } from "@/lib/mcp/install";
import { InstallTabs } from "@/app/developers/DevClient";

// "Access keys": keys for Populr's MCP server and VS Code extension.
//
// A key is shown once, in full, at the moment it's made — only a hash is kept — so the card
// says so and makes copying it the obvious next step. Keys list by name and first
// characters with when each was last used, so a stale one is easy to spot and revoke.
//
// Kept quiet on purpose: on the keys page the header already explains what this is for, and
// on the dashboard it sits under the SEO audit. The name field only appears when you ask for
// a new key, and revoking confirms in the row instead of in a browser dialog.

type Key = { id: string; name: string; hint: string; createdAt: number; lastUsedAt: number | null };

const DAY = 86_400_000;

function used(t: number | null) {
  if (!t) return "Never used";
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "Used just now" : m < 60 ? `Used ${m} min ago` : m < 1440 ? `Used ${Math.round(m / 60)} h ago` : `Used ${Math.round(m / 1440)} d ago`;
}

const created = (t: number) => new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export default function EditorAccess({ intro = true }: { intro?: boolean }) {
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const d = await fetch(`/api/mcp/keys?wsid=${encodeURIComponent(workspaceId())}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    // On a failed re-read, keep showing the list already on screen.
    if (d?.ok) { setKeys(d.keys); setLoadFailed(false); } else setLoadFailed(true);
  }, []);
  // Reload when the tab comes back into view: you make a key, connect your editor in another
  // window, and on return the key shows as in use.
  useEffect(() => {
    load();
    const back = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [load]);
  useEffect(() => { if (adding) nameRef.current?.focus(); }, [adding]);

  const create = async () => {
    setBusy(true); setNote(null);
    const r = await fetch("/api/mcp/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wsid: workspaceId(), name: name.trim() || "Code editor" }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setNote(d.detail ?? "Couldn't create a key. Try again."); return; }
    setFresh(d.key); setCopied(false); setName(""); setAdding(false); load();
  };

  const revoke = async (id: string) => {
    setConfirming(null);
    const r = await fetch(`/api/mcp/keys?wsid=${encodeURIComponent(workspaceId())}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setNote(r.ok ? "Key revoked. Anything using it has stopped working." : "Couldn't revoke that key. Try again.");
    load();
  };

  const copy = () => {
    if (!fresh) return;
    navigator.clipboard?.writeText(fresh).then(() => setCopied(true), () => setNote("Couldn't copy — select the key and copy it."));
  };

  return (
    <section className="ap-card ek">
      <div className="ek-head">
        <div>
          <h3>Access keys{keys?.length ? <span className="ek-count">{keys.length}</span> : null}</h3>
          <p className="ek-sub">
            {intro
              ? <>Let your coding assistant apply your approved SEO fixes in your site&apos;s code. </>
              : <>One key per editor or machine, so you can revoke one without touching the others. </>}
            <a href="/developers/docs" target="_blank" rel="noopener">Setup guide</a>
          </p>
        </div>
        {!adding && !fresh && <button className="ek-new" onClick={() => { setAdding(true); setNote(null); }}><span aria-hidden="true">+</span> New key</button>}
      </div>

      {adding && (
        <form className="ek-add" onSubmit={(e) => { e.preventDefault(); create(); }}>
          <input ref={nameRef} placeholder="Name it after where it's used, e.g. Work laptop" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="Key name" />
          <button type="submit" className="ek-go" disabled={busy}>{busy ? "Creating…" : "Create"}</button>
          <button type="button" className="ek-quiet" onClick={() => { setAdding(false); setName(""); }}>Cancel</button>
        </form>
      )}

      {fresh && (
        <div className="ek-fresh" role="status">
          <p className="ek-fresh-t">Your new key</p>
          <div className="ek-keyline">
            <code>{fresh}</code>
            <button className="ek-copy" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
          </div>
          <p className="ek-warn">Copy it now — it won&apos;t be shown again. Populr keeps only a fingerprint.</p>
          <p className="ek-step">Add Populr to your editor — your key is already filled in:</p>
          <InstallTabs tabs={installTabs(fresh)} />
          <button className="ek-done" onClick={() => setFresh(null)}>Done</button>
        </div>
      )}

      {keys && keys.length > 0 && (
        <ul className="ek-list">
          {keys.map((k) => {
            const state = !k.lastUsedAt ? "never" : Date.now() - k.lastUsedAt < 30 * DAY ? "active" : "idle";
            return (
              <li key={k.id}>
                <span className={`ek-dot ${state}`} title={state === "active" ? "In use" : state === "idle" ? "Not used for 30 days" : "Never used"} aria-hidden="true" />
                <div className="ek-who">
                  <b>{k.name}</b>
                  <span>Created {created(k.createdAt)} · {used(k.lastUsedAt)}</span>
                </div>
                <code className="ek-hint">{k.hint}</code>
                {confirming === k.id ? (
                  <span className="ek-confirm">
                    <button className="ek-danger" onClick={() => revoke(k.id)}>Revoke</button>
                    <button className="ek-quiet" onClick={() => setConfirming(null)}>Keep</button>
                  </span>
                ) : (
                  <button className="ek-quiet ek-revoke" onClick={() => setConfirming(k.id)} aria-label={`Revoke ${k.name}`}>Revoke</button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!keys && loadFailed && (
        <p className="ek-empty">Couldn&apos;t load your keys. <button className="ek-quiet" onClick={load}>Try again</button></p>
      )}

      {keys && keys.length === 0 && !adding && !fresh && (
        <p className="ek-empty">No keys yet. Create one for each editor you use.</p>
      )}

      {note && <p className="ek-note" role="status">{note}</p>}
      <p className="ek-fine"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9v6.5h-9z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>A key opens only this workspace&apos;s SEO settings. Populr stores a fingerprint of it, never the key itself.</p>
    </section>
  );
}
