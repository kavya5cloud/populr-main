import type { Metadata } from "next";
import { TOOLS } from "@/lib/mcp/tools";
import { installTabs, MCP_URL } from "@/lib/mcp/install";
import { CopyBlock, InstallTabs, SessionDemo } from "./DevClient";

// /developers — Populr's MCP server, for the people who ship the site.
//
// One idea, said several ways: the owner approves SEO changes in Populr, and the developer's
// AI assistant applies them in the code. Every claim on the page is something the server
// actually does; the session in the hero is labelled as an example.

export const metadata: Metadata = {
  title: "SEO fixes in your code editor — MCP server",
  description: "Connect Claude Code, Cursor, VS Code or Windsurf to Populr. Your assistant applies the SEO fixes your team approved — titles, descriptions, structured data — in the HTML itself.",
  alternates: { canonical: "/developers" },
  openGraph: {
    type: "website", url: "/developers",
    title: "Populr MCP server — ship approved SEO fixes from your editor",
    description: "One line of config. Your AI coding assistant gets the fixes your team approved, applies them in code, and verifies they're live.",
  },
  twitter: { card: "summary_large_image", title: "Populr MCP server", description: "Ship approved SEO fixes from your code editor." },
};

const STEPS = [
  { t: "Approve in Populr", d: "Populr drafts better titles, descriptions and structured data from what each page actually says. The site owner approves them — nothing ships unapproved." },
  { t: "Apply in code", d: "Ask your assistant to apply your Populr fixes. It reads them through MCP and edits the page head or your framework's metadata — Next.js, Nuxt, Astro, plain HTML." },
  { t: "Verify it's live", d: "After you deploy, verify_page fetches the live page and checks each change is in the HTML as served. No guessing whether the build picked it up." },
];

const FAQ = [
  { q: "Do I need the Populr script on my site as well?", a: "No. The script applies approved fixes in the browser, which Google reads. Applying them in code puts them in the HTML itself, which every crawler and link preview reads. Many teams start with the script and move fixes into code as they ship." },
  { q: "Can the assistant change anything in Populr?", a: "One tool writes: draft_page_fix saves a draft for the owner to approve. Nothing an assistant does through Populr publishes, approves or changes a live site — your own deploy does that." },
  { q: "Which editors work?", a: "Any client that speaks MCP over HTTP: Claude Code, Cursor, VS Code (with or without the Populr extension), Windsurf, and others. The server is stateless and needs only an Authorization header." },
  { q: "What does a key give access to?", a: "Exactly one workspace's SEO settings. Keys are created and revoked in Populr, shown once, stored only as a fingerprint, and rate limited." },
  { q: "Does it cost extra?", a: "No. It's part of Populr — the first month is free." },
];

export default function Developers() {
  const tabs = installTabs();
  return (
    <div className="dv">
      <header className="dv-hero">
        <div className="dv-frame">
          <div className="dv-left">
            <nav className="dv-nav" aria-label="Main">
              <a href="/" className="dv-logo">Populr.</a>
              <div className="dv-pills">
                <a href="#install">Install</a>
                <a href="/developers/docs">Docs</a>
                <a href="/app/keys" className="on">Get a key</a>
              </div>
            </nav>
            <div className="dv-copy">
              <p className="dv-eyebrow"><i aria-hidden="true" />MCP server · for developers</p>
              <h1>Ship your SEO <span>from your code editor.</span></h1>
              <p className="dv-sub">
                Your team approves SEO changes in Populr. Your AI coding assistant applies them in the code — titles,
                descriptions, structured data — and checks they&apos;re live. In the HTML, where every crawler reads it.
              </p>
              <div className="dv-ctas">
                <a href="/app/keys" className="dv-btn">Get an access key</a>
                <a href="/developers/docs" className="dv-btn ghost">Read the docs</a>
              </div>
              <p className="dv-works">Works with <b>Claude Code</b> · <b>Cursor</b> · <b>VS Code</b> · <b>Windsurf</b></p>
            </div>
          </div>
          <div className="dv-right">
            <SessionDemo />
          </div>
        </div>
      </header>

      <main>
        <section id="install" className="dv-sec">
          <p className="dv-kicker">Install</p>
          <h2>One line of config.</h2>
          <p className="dv-lead"><a href="/app/keys">Create an access key</a> in Populr, then add Populr to your editor. The key page fills it into these for you.</p>
          <InstallTabs tabs={tabs} />
        </section>

        <section className="dv-sec">
          <p className="dv-kicker">How it works</p>
          <h2>Approve once. Ship it properly.</h2>
          <ol className="dv-steps">
            {STEPS.map((s, i) => (<li key={s.t}><span>{i + 1}</span><h3>{s.t}</h3><p>{s.d}</p></li>))}
          </ol>
        </section>

        <section className="dv-sec">
          <p className="dv-kicker">Why in code</p>
          <h2>Not everything that reads your site runs JavaScript.</h2>
          <p className="dv-lead">Populr&apos;s one-line script applies approved fixes in the browser, and Google reads those. Most AI crawlers and every link preview read only the HTML as served.</p>
          <div className="dv-table-wrap">
            <table className="dv-table">
              <thead><tr><th>Who reads your page</th><th>Applied by script</th><th>Applied in code</th></tr></thead>
              <tbody>
                <tr><td>Google Search</td><td>✓</td><td>✓</td></tr>
                <tr><td>Most AI crawlers (ChatGPT, Claude, Perplexity)</td><td className="no">Usually not — they don&apos;t run JavaScript</td><td>✓</td></tr>
                <tr><td>Link previews (WhatsApp, Slack, LinkedIn, X)</td><td className="no">No</td><td>✓</td></tr>
                <tr><td>Other search engines</td><td className="no">Varies</td><td>✓</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="dv-sec">
          <p className="dv-kicker">Tools</p>
          <h2>Seven tools. One of them writes.</h2>
          <div className="dv-tools">
            {TOOLS.map((t) => (
              <article key={t.name} className={t.annotations.readOnlyHint ? "" : "writes"}>
                <code>{t.name}</code>
                <p>{t.description}</p>
                <span className="dv-tag">{t.annotations.readOnlyHint ? "Read-only" : "Saves a draft for approval"}</span>
              </article>
            ))}
          </div>
        </section>

        <section className="dv-sec dv-split">
          <div>
            <p className="dv-kicker">VS Code extension</p>
            <h2>Or skip the config.</h2>
            <p className="dv-lead">The Populr extension connects VS Code&apos;s agent mode to Populr, keeps your key in VS Code&apos;s secret storage, and adds commands to audit a page, insert structured data and create llms.txt.</p>
            <div className="dv-ext-cta">
              <a href="/downloads/populr-seo.vsix" download className="dv-btn">Download for VS Code</a>
              <a href="/developers/docs#vscode" className="dv-btn ghost">Extension guide</a>
            </div>
          </div>
          <div>
            <p className="dv-kicker">Security</p>
            <h2>Scoped, revocable, read-mostly.</h2>
            <ul className="dv-list">
              <li>A key opens one workspace&apos;s SEO settings — nothing else.</li>
              <li>Shown once, stored as a SHA-256 fingerprint, revocable any time.</li>
              <li>Six of seven tools only read. Nothing publishes or changes a live site.</li>
              <li>Page fetches refuse private addresses and re-check every redirect.</li>
              <li>Rate limited per key.</li>
            </ul>
          </div>
        </section>

        <section className="dv-sec">
          <p className="dv-kicker">Questions</p>
          <h2>Before you connect it.</h2>
          <dl className="dv-faq">{FAQ.map((f) => (<div key={f.q}><dt>{f.q}</dt><dd>{f.a}</dd></div>))}</dl>
        </section>

        <section className="dv-end">
          <h2>Your SEO, shipped like code.</h2>
          <CopyBlock label="Server URL" code={MCP_URL} />
          <div className="dv-ctas center">
            <a href="/app/keys" className="dv-btn">Get an access key</a>
            <a href="/developers/docs" className="dv-btn ghost">Docs</a>
          </div>
        </section>
      </main>
    </div>
  );
}
