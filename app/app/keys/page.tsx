"use client";

import { useEffect, useState } from "react";
import { loadLocal } from "@/lib/store";
import EditorAccess from "../_components/EditorAccess";
import SeoAutopilot from "../_components/SeoAutopilot";
import { AuthModal } from "../_components/AuthModal";
import KeysHeader from "./KeysHeader";
import BackLink from "@/app/components/BackLink";

// /app/keys — where "Get an access key" lands.
//
// It used to point at the dashboard, where the key card sat under Analytics → SEO: a
// developer arriving from the landing page had no way to find it. Here it is the first thing
// on the page, with the SEO autopilot underneath, because every tool reads the autopilot's
// settings and a key is no use until it's set up.
//
// Keys belong to an account, so a signed-out visitor sees a sign-in card instead of the key
// list (the key routes refuse them too). Without accounts — local development, no database —
// the browser workspace stands in, as it does everywhere else in the app.

type Me = { user: { email: string } | null; accountsEnabled: boolean };

export default function KeysPage() {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [me, setMe] = useState<Me | null>(null);
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    setUrl(loadLocal()?.url || null);
    fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).then(setMe).catch(() => setMe({ user: null, accountsEnabled: false }));
  }, []);

  const signedOut = !!me && me.accountsEnabled && !me.user;

  return (
    <div className="appui">
      <div className="keys-wrap">
        <div className="asst-top">
          <BackLink />
          <span className="app-wordmark">Populr.</span>
        </div>
        <KeysHeader enabled={!!me && !signedOut} />

        {me === null && <section className="ap-card ek ek-loading" aria-busy="true" />}

        {signedOut && (
          <section className="ap-card ek ek-signin">
            <div className="ek-head">
              <div>
                <h3>Sign in to create access keys</h3>
                <p className="ek-sub">Keys belong to your Populr account, so you can see, use and revoke them from any device — and each one opens only your workspace.</p>
              </div>
            </div>
            <div className="ek-signin-row">
              <button className="ek-go" onClick={() => setAuthOpen(true)}>Sign in / Create account</button>
              <a className="ek-quiet" href="/developers/docs" target="_blank" rel="noopener">Read the setup guide</a>
            </div>
          </section>
        )}

        {me && !signedOut && (
          <>
            <EditorAccess intro={false} />
            {url === null && (
              <section className="ap-card">
                <div className="ap-head"><h3>First, tell Populr your site</h3></div>
                <p className="ap-lede">The tools work from your site&apos;s SEO settings. Analyse your website once and the SEO autopilot appears here.</p>
                <a className="ap-primary" href="/app">Analyse my site</a>
              </section>
            )}
            {url && <SeoAutopilot url={url} />}
          </>
        )}
      </div>
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} next="/app/keys" />}
    </div>
  );
}
