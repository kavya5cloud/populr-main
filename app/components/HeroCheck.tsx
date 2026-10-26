"use client";

import { useCallback, useState } from "react";

// The hero's right-hand panel: what Populr finds on a website, before anyone signs up.
//
// Until a visitor types their address it shows an example, labelled as one and tied to no
// real domain — a made-up score next to a real business's name would be exactly the kind of
// claim this site refuses to make. When they type theirs, the hero form runs the real free
// check (/api/check, the same one as /check) and this card shows their actual result, with
// the way into Populr: fix what failed.

type Check = { id: string; label: string; passed: boolean; detail: string; points: number };
type Result = { domain: string; score: number; checks: Check[] };

export type HeroCheckState =
  | { kind: "example" }
  | { kind: "checking"; site: string }
  | { kind: "result"; result: Result }
  | { kind: "error"; site: string; message: string };

export function useHeroCheck() {
  const [state, setState] = useState<HeroCheckState>({ kind: "example" });
  const run = useCallback(async (site: string) => {
    setState({ kind: "checking", site });
    try {
      const r = await fetch("/api/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: site }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.result) setState({ kind: "result", result: d.result });
      else setState({ kind: "error", site, message: d.message ?? "The check didn't finish." });
    } catch {
      setState({ kind: "error", site, message: "The check didn't finish." });
    }
  }, []);
  return { state, run };
}

// The example: a bakery whose site is in decent shape for Google but says little to AI
// assistants. All fourteen checks, with their real labels and points, so the score shown is
// the sum of what passes — the same arithmetic as a real result.
const EXAMPLE: Check[] = [
  { id: "title", label: "Page title", passed: true, detail: "", points: 10 },
  { id: "description", label: "Meta description", passed: true, detail: "", points: 10 },
  { id: "h1", label: "One main heading (H1)", passed: true, detail: "", points: 5 },
  { id: "canonical", label: "Canonical address", passed: true, detail: "", points: 5 },
  { id: "viewport", label: "Mobile-friendly viewport", passed: true, detail: "", points: 5 },
  { id: "https", label: "Served over HTTPS", passed: true, detail: "", points: 5 },
  { id: "sitemap", label: "Sitemap", passed: true, detail: "", points: 5 },
  { id: "crawlable", label: "Open to search engines", passed: true, detail: "", points: 5 },
  { id: "jsonld", label: "Structured data", passed: false, detail: "Google has to guess what the business is", points: 10 },
  { id: "business", label: "Business identity in structured data", passed: false, detail: "No name, address or hours stated", points: 5 },
  { id: "og", label: "Link previews (Open Graph)", passed: true, detail: "", points: 10 },
  { id: "llms", label: "llms.txt for AI assistants", passed: false, detail: "No map of the site for AI", points: 10 },
  { id: "ai-crawlers", label: "AI crawlers allowed", passed: false, detail: "robots.txt keeps out PerplexityBot", points: 10 },
  { id: "lang", label: "Language declared", passed: true, detail: "", points: 5 },
];
const EXAMPLE_SCORE = EXAMPLE.filter((c) => c.passed).reduce((n, c) => n + c.points, 0);

function Ring({ score }: { score: number }) {
  const tone = score >= 90 ? "#7fb53a" : score >= 60 ? "#d9a52e" : "#d9603f";
  return (
    <div className="hk-ring" style={{ ["--pct" as string]: score, ["--tone" as string]: tone }} aria-label={`Score ${score} out of 100`}>
      <b>{score}</b><span>/100</span>
    </div>
  );
}

function Rows({ checks }: { checks: Check[] }) {
  return (
    <ul className="hk-rows">
      {checks.map((c) => (
        <li key={c.id} className={c.passed ? "ok" : "no"}>
          <i aria-hidden="true">{c.passed ? "✓" : "✕"}</i>
          <span><b>{c.label}</b>{!c.passed && c.detail ? <small>{c.detail}</small> : null}</span>
        </li>
      ))}
    </ul>
  );
}

/** Failures first, so the card leads with what Populr would fix; then passes, up to six rows. */
const pick = (checks: Check[]) => [...checks.filter((c) => !c.passed).slice(0, 4), ...checks.filter((c) => c.passed)].slice(0, 6);

export function HeroCheckCard({ state, onFocusInput }: { state: HeroCheckState; onFocusInput: () => void }) {
  if (state.kind === "checking") {
    return (
      <div className="hk-card" aria-live="polite" aria-busy="true">
        <div className="hk-head"><span className="hk-label">Checking</span><b className="hk-domain">{state.site}</b></div>
        <ul className="hk-steps">
          <li>Reading the home page as Google sees it</li>
          <li>robots.txt — which crawlers are let in</li>
          <li>Structured data, llms.txt, sitemap</li>
        </ul>
        <p className="hk-note">About ten seconds.</p>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="hk-card" aria-live="polite">
        <div className="hk-head"><span className="hk-label">Couldn&apos;t check</span><b className="hk-domain">{state.site}</b></div>
        <p className="hk-note">{state.message}</p>
        <a className="hk-cta" href={`/app?url=${encodeURIComponent(state.site)}`}>Start with Populr anyway →</a>
      </div>
    );
  }

  if (state.kind === "result") {
    const { result } = state;
    const failed = result.checks.filter((c) => !c.passed);
    return (
      <div className="hk-card" aria-live="polite">
        <div className="hk-head">
          <div><span className="hk-label">Your site</span><b className="hk-domain">{result.domain}</b></div>
          <Ring score={result.score} />
        </div>
        <Rows checks={pick(result.checks)} />
        <a className="hk-cta" href={`/app?url=${encodeURIComponent(result.domain)}`}>
          {failed.length ? `Fix ${failed.length === 1 ? "it" : `all ${failed.length}`} with Populr →` : "Everything passes — keep it that way →"}
        </a>
        <a className="hk-more" href={`/check/${result.domain}`}>See the full report</a>
      </div>
    );
  }

  return (
    <div className="hk-card">
      <div className="hk-head">
        <div><span className="hk-label">Example</span><b className="hk-domain">A neighbourhood bakery&apos;s site</b></div>
        <Ring score={EXAMPLE_SCORE} />
      </div>
      <Rows checks={pick(EXAMPLE)} />
      <button type="button" className="hk-cta" onClick={onFocusInput}>Check your own site — free, 10 seconds</button>
      <p className="hk-more">An example of what the free check finds.</p>
    </div>
  );
}
