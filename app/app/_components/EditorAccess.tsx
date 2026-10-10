"use client";

import { useCallback, useEffect, useState } from "react";
import { workspaceId } from "@/lib/store";
import { installTabs } from "@/lib/mcp/install";
import { InstallTabs } from "@/app/developers/DevClient";

// "Use in your code editor": access keys for Populr's MCP server and VS Code extension.
//
// A key is shown once, in full, at the moment it's made — only a hash is kept — so the card
// says so and makes copying it the obvious next step. Keys list by name and first
// characters with when each was last used, so a stale one is easy to spot and revoke.

type Key = { id: string; name: string; hint: string; createdAt: number; lastUsedAt: number | null };

function ago(t: number | null) {
  if (!t) return "never used";
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "used just now" : m < 60 ? `used ${m} min ago` : m < 1440 ? `used ${Math.round(m / 60)} h ago` : `used ${Math.round(m / 1440)} d ago`;
}

export default function EditorAccess() {
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await fetch(`/api/mcp/keys?wsid=${encodeURIComponent(workspaceId())}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    if (d?.ok) setKeys(d.keys);
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setBusy(true); setNote(null);
    const r = await fetch("/api/mcp/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wsid: workspaceId(), name: name || "Code editor" }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setNote(d.detail ?? "Couldn't create a key."); return; }
    setFresh(d.key); setName(""); load();
  };

  const revoke = async (id: string) => {
    if (!confirm("Revoke this key? Anything using it stops working immediately.")) return;
    await fetch(`/api/mcp/keys?wsid=${encodeURIComponent(workspaceId())}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
    load();
  };


  return (
    <section className="ap-card">
      <div className="ap-head"><h3>Use in your code editor</h3></div>
      <p className="ap-lede">Let Claude Code, Cursor, VS Code or Windsurf apply your approved SEO fixes directly in your site&apos;s code — so every search engine sees them, not just Google. <a href="/developers/docs" target="_blank" rel="noopener">Setup guide</a></p>

      {fresh && (
        <div className="ek-fresh" role="status">
          <p><b>Copy this key now — it won&apos;t be shown again.</b></p>
          <div className="ap-tag"><code>{fresh}</code><button className="ap-secondary" onClick={() => navigator.clipboard?.writeText(fresh).then(() => setNote("Key copied."))}>Copy</button></div>
          <p className="ap-hint">Then add Populr to your editor — your key is already filled in:</p>
          <InstallTabs tabs={installTabs(fresh)} />
          <button className="ap-link" onClick={() => setFresh(null)}>I&apos;ve saved it</button>
        </div>
      )}

      <div className="ap-row">
        <input className="ap-path" placeholder="Name, e.g. Work laptop" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="Key name" />
        <button className="ap-primary" disabled={busy} onClick={create}>{busy ? "Creating…" : "Create access key"}</button>
      </div>

      {keys && keys.length > 0 && (
        <ul className="ek-list">
          {keys.map((k) => (
            <li key={k.id}>
              <span><b>{k.name}</b> <code>{k.hint}</code></span>
              <span className="ap-hint">{ago(k.lastUsedAt)}</span>
              <button className="ap-link" onClick={() => revoke(k.id)}>Revoke</button>
            </li>
          ))}
        </ul>
      )}
      <p className="ap-fine">A key opens only this workspace&apos;s SEO settings. Populr stores a fingerprint of it, never the key itself.</p>
      {note && <p className="ap-note">{note}</p>}
    </section>
  );
}
