"use client";

import { useEffect, useState } from "react";
import { workspaceId } from "@/lib/store";
import { AuthModal } from "@/app/app/_components/AuthModal";
import type { AuthorizeParams } from "@/lib/oauth/service";

// The consent card. The app's name comes from the app itself, so it's labelled as such and
// shown with where it will send you back to — a look-alike name can't hide that.

type Me = { user: { email: string } | null; accountsEnabled: boolean };

const CAN = [
  "Read your SEO settings, approved fixes and drafts",
  "Set up your site and save your business details",
  "Draft page titles and descriptions, and approve them when you say so",
  "Audit and verify public pages",
];

export default function Consent({ clientName, returnsTo, params }: { clientName: string; returnsTo: string; params: AuthorizeParams }) {
  const [me, setMe] = useState<Me | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).then(setMe).catch(() => setMe({ user: null, accountsEnabled: false }));
  }, []);

  const decide = async (decision: "allow" | "deny") => {
    setBusy(decision); setError(null);
    const r = await fetch("/api/oauth/authorize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ params, decision, wsid: workspaceId() }) });
    const d = await r.json().catch(() => ({}));
    if (d.redirect) { setSent(true); window.location.assign(d.redirect); return; }
    setBusy(null);
    setError(d.error === "sign_in_required" ? "Your session ended — sign in again." : d.message ?? "Something went wrong. Start again from your editor.");
  };

  const signedOut = !!me && me.accountsEnabled && !me.user;
  const here = typeof window !== "undefined" ? window.location.pathname + window.location.search : "/oauth/authorize";

  if (sent) {
    return (
      <section className="oa-card">
        <h1>You&apos;re connected</h1>
        <p className="oa-lead">You can close this tab and go back to {clientName}.</p>
      </section>
    );
  }

  return (
    <section className="oa-card">
      <p className="oa-eyebrow"><i aria-hidden="true" />Connect an app</p>
      <h1><span className="oa-app">{clientName}</span> wants to use Populr</h1>
      <p className="oa-lead">It will act for your workspace{me?.user ? <> (<b>{me.user.email}</b>)</> : null}, and only through Populr&apos;s SEO tools. It can:</p>
      <ul className="oa-can">{CAN.map((c) => <li key={c}>{c}</li>)}</ul>
      <p className="oa-fine">It can&apos;t see your other data, post anywhere, or change your code. Your editor still asks you before a tool saves anything. You can disconnect it any time on <a href="/app/keys">the keys page</a>.</p>
      <p className="oa-return">Returns to <code>{returnsTo}</code> · the name above comes from the app itself — only allow it if you just connected Populr from your editor.</p>

      {me === null ? <div className="oa-wait" aria-busy="true" /> : signedOut ? (
        <div className="oa-actions">
          <button className="ck-btn" onClick={() => setAuthOpen(true)}>Sign in to continue</button>
          <button className="oa-cancel" onClick={() => decide("deny")} disabled={!!busy}>Cancel</button>
        </div>
      ) : (
        <div className="oa-actions">
          <button className="ck-btn lime" onClick={() => decide("allow")} disabled={!!busy}>{busy === "allow" ? "Connecting…" : "Allow"}</button>
          <button className="oa-cancel" onClick={() => decide("deny")} disabled={!!busy}>{busy === "deny" ? "Cancelling…" : "Cancel"}</button>
        </div>
      )}
      {error && <p className="ck-error" role="alert">{error}</p>}
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} next={here} />}
    </section>
  );
}
