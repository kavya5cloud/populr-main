import type { Metadata } from "next";
import { runChecks } from "@/lib/check/checks";
import { CheckForm } from "./CheckClient";

// /check — the free SEO & AI-readiness check. Indexable: it's a tool people search for.
// Each result lives at /check/<domain>, made to be shared.

export const metadata: Metadata = {
  title: "Free SEO & AI visibility check",
  description: "Check your site in ten seconds: 14 things Google, ChatGPT, Claude and Perplexity look for — titles, structured data, llms.txt, AI crawler access. Free.",
  alternates: { canonical: "/check" },
};

// The list of checks comes from the checks themselves, so the page can't drift from them.
const CHECKS = runChecks({ finalUrl: "https://example.com/", html: "", robots: null, llms: null, sitemap: null });

const FAQ = [
  { q: "Is it free?", a: "Yes. No sign-up, no email. Run it on your site or a competitor's." },
  { q: "What does it look at?", a: "Your home page as it's served, plus robots.txt, /llms.txt and /sitemap.xml — the same public files search engines and AI crawlers read. Nothing behind a login." },
  { q: "How is the score worked out?", a: "Each check is worth the points shown, and the score is the total of the checks your site passes. Nothing is estimated — every line says what we found." },
  { q: "Why does AI readiness matter?", a: "More people ask ChatGPT, Claude or Perplexity which business to use. They can only recommend what they can read and understand: structured data, an llms.txt, and robots.txt rules that let their crawlers in." },
  { q: "How do I fix what it finds?", a: "Each failed check says what to change. Or let Populr do it: it drafts the fixes, you approve them, and they go live — through a one-line snippet or your coding agent." },
];

export default function CheckPage() {
  return (
    <div className="dv">
      <main className="ck">
        <header className="ck-top">
          <a href="/" className="ck-logo">Populr<span>.</span></a>
          <nav aria-label="Main" className="ck-links">
            <a href="/tools">Free tools</a>
            <a href="/guides">Guides</a>
            <a href="/developers">Developers</a>
            <a href="/app" className="ck-pill">Get started</a>
          </nav>
        </header>

        <section className="ck-hero">
          <p className="ck-eyebrow"><i aria-hidden="true" />Free · 10 seconds · no sign-up</p>
          <h1>Can Google — and ChatGPT — find your business?</h1>
          <p className="ck-sub">Fourteen checks on what search engines and AI assistants read: your titles, structured data, link previews, llms.txt and whether AI crawlers are let in. Get a score you can share and a fix for everything that fails.</p>
          <CheckForm />
        </section>

        <section className="ck-what" aria-labelledby="what">
          <h2 id="what">What it checks</h2>
          <div className="ck-what-grid">
            {(["search", "ai"] as const).map((g) => (
              <div key={g} className="ck-what-col">
                <h3>{g === "search" ? "Search basics" : "AI & sharing readiness"} <span>50 pts</span></h3>
                <ul>
                  {CHECKS.filter((c) => c.group === g).map((c) => <li key={c.id}><span>{c.label}</span><b>{c.points}</b></li>)}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="ck-faq" aria-labelledby="faq">
          <h2 id="faq">Questions</h2>
          {FAQ.map((f) => (
            <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>
          ))}
        </section>

        <footer className="ck-foot">
          <a href="/">Populr</a> — the AI CMO for small businesses. <a href="/tools">Free tools</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
        </footer>
      </main>
    </div>
  );
}
