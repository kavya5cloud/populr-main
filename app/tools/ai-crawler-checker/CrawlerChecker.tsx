"use client";

import { useState } from "react";
import type { CrawlerReport, RobotsReport } from "@/lib/tools/robots";

const KINDS: { kind: CrawlerReport["kind"]; title: string; note: string }[] = [
  { kind: "answers", title: "AI search & answers", note: "Block these and the assistant can't find or quote you." },
  { kind: "training", title: "AI training", note: "These only decide whether your text trains models. Blocking them is a choice." },
  { kind: "search", title: "Search engines", note: "Google's AI Overviews and Copilot draw on these too." },
];

function allowLines(blocked: CrawlerReport[]): string {
  return [...blocked.map((c) => `User-agent: ${c.agent}`), "Allow: /"].join("\n");
}

export default function CrawlerChecker() {
  const [site, setSite] = useState("");
  const [path, setPath] = useState("/");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<{ domain: string; report: RobotsReport; robotsTxt: string | null } | null>(null);
  const [copied, setCopied] = useState(false);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!site.trim() || busy) return;
    setBusy(true); setError(null);
    const r = await fetch(`/api/tools/robots?url=${encodeURIComponent(site.trim())}&path=${encodeURIComponent(path.trim() || "/")}`).catch(() => null);
    const d = await r?.json().catch(() => ({}));
    setBusy(false);
    if (!r?.ok) { setError(d?.message ?? "The check failed. Try again in a moment."); return; }
    setRes(d);
  };

  const blockedAnswers = res?.report.crawlers.filter((c) => c.kind === "answers" && !c.allowed) ?? [];
  const blockedSearch = res?.report.crawlers.filter((c) => c.kind === "search" && !c.allowed) ?? [];

  return (
    <div className="tl-tool">
      <form className="ck-form" onSubmit={run}>
        <div className="ck-field">
          <input value={site} onChange={(e) => setSite(e.target.value)} placeholder="yourbusiness.com" aria-label="Website address" inputMode="url" autoComplete="url" spellCheck={false} disabled={busy} />
          <button type="submit" disabled={busy || !site.trim()}>{busy ? "Checking…" : "Check crawlers"}</button>
        </div>
        <label className="tl-inline">Page to test <input value={path} onChange={(e) => setPath(e.target.value)} aria-label="Page path" spellCheck={false} /></label>
        {error && <p className="ck-error" role="alert">{error}</p>}
      </form>

      {res && (
        <div className="tl-result" aria-live="polite">
          <p className={"tl-verdict " + (blockedAnswers.length || blockedSearch.length ? "bad" : "good")}>
            {res.report.file === "unreachable"
              ? `${res.domain}'s robots.txt didn't answer. Crawlers treat that as "keep out" until it does — so right now none of them will read the site.`
              : blockedAnswers.length || blockedSearch.length
                ? `${[...blockedSearch, ...blockedAnswers].map((c) => c.agent).join(", ")} ${blockedAnswers.length + blockedSearch.length === 1 ? "is" : "are"} blocked from ${res.report.path} on ${res.domain}.`
                : `AI assistants and search engines can read ${res.report.path} on ${res.domain}.${res.report.file === "missing" ? " There's no robots.txt, so nothing is blocked." : ""}`}
          </p>
          {KINDS.map((k) => (
            <div key={k.kind} className="tl-group">
              <h3>{k.title} <span>{k.note}</span></h3>
              <div className="tl-table" role="table" aria-label={k.title}>
                {res.report.crawlers.filter((c) => c.kind === k.kind).map((c) => (
                  <div key={c.agent} className="tl-row" role="row">
                    <span role="cell" className="tl-agent"><code>{c.agent}</code><small>{c.owner}</small></span>
                    <span role="cell" className="tl-purpose">{c.purpose}</span>
                    <span role="cell" className={"tl-pill " + (c.allowed ? "on" : "off")}>{c.allowed ? "Allowed" : "Blocked"}</span>
                    <span role="cell" className="tl-rule">{c.rule ? <code>{c.rule}</code> : c.matchedBy ? "No rule matches" : "No group applies"}{c.matchedBy && c.matchedBy !== c.agent ? <small> via User-agent: {c.matchedBy}</small> : null}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {blockedAnswers.length > 0 && res.report.file === "found" && (
            <div className="tl-fix">
              <p>To let them in, add this group to robots.txt. A crawler obeys only the group that names it, so this overrides the rules in your <code>*</code> group for these crawlers alone:</p>
              <div className="dv-code">
                <div className="dv-code-head"><span className="dv-code-label">robots.txt</span><button className="dv-copybtn" onClick={() => navigator.clipboard?.writeText(allowLines(blockedAnswers)).then(() => setCopied(true))}>{copied ? "Copied" : "Copy"}</button></div>
                <pre>{allowLines(blockedAnswers)}</pre>
              </div>
            </div>
          )}
          {res.robotsTxt !== null && (
            <details className="tl-raw"><summary>The robots.txt we read</summary><pre>{res.robotsTxt || "(empty)"}</pre></details>
          )}
        </div>
      )}
    </div>
  );
}
