"use client";

import { useEffect, useState } from "react";
import { loadLocal } from "@/lib/store";
import EditorAccess from "../_components/EditorAccess";
import SeoAutopilot from "../_components/SeoAutopilot";

// /app/keys — where "Get an access key" lands.
//
// It used to point at the dashboard, where the key card sat under Analytics → SEO: a
// developer arriving from the landing page had no way to find it. Here it is the first thing
// on the page, with the SEO autopilot underneath, because every tool reads the autopilot's
// settings and a key is no use until it's set up.

export default function KeysPage() {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => { setUrl(loadLocal()?.url || null); }, []);

  return (
    <div className="appui">
      <div className="team-wrap keys-wrap">
        <div className="asst-top">
          <a href="/app">← Back to dashboard</a>
          <span className="app-wordmark">Populr.</span>
        </div>
        <header className="team-head">
          <h1>Access keys</h1>
          <p>Connect Claude Code, Cursor, VS Code or Windsurf to Populr, so your coding assistant can apply your approved SEO fixes in your site&apos;s code. <a href="/developers/docs">How it works</a></p>
        </header>

        <EditorAccess />

        {url === null && (
          <section className="ap-card">
            <div className="ap-head"><h3>First, tell Populr your site</h3></div>
            <p className="ap-lede">The tools work from your site&apos;s SEO settings. Analyse your website once and the SEO autopilot appears here.</p>
            <a className="ap-primary" href="/app">Analyse my site</a>
          </section>
        )}
        {url && <SeoAutopilot url={url} />}
      </div>
    </div>
  );
}
