"use client";

import { useMemo, useState } from "react";
import { CRAWLERS, parseRobots, verdictFor, type Crawler } from "@/lib/tools/robots";

// Builds a robots.txt, then reads it back with the same parser the AI crawler checker uses —
// so "what each crawler will do" below is what crawlers will actually conclude from the
// file, not what we meant it to say.

type Preset = "open" | "search-only" | "no-ai";
const PRESETS: { id: Preset; label: string; note: string }[] = [
  { id: "search-only", label: "AI search yes, AI training no", note: "Recommended for most businesses: ChatGPT, Claude and Perplexity can find and cite you; your text stays out of model training." },
  { id: "open", label: "Open to everyone", note: "Every crawler may read the site." },
  { id: "no-ai", label: "Block all AI", note: "Keeps out every AI crawler — including the ones that let assistants recommend you." },
];
const blockedBy = (p: Preset): Set<string> => new Set(CRAWLERS.filter((c) => (p === "no-ai" ? c.kind !== "search" : p === "search-only" ? c.kind === "training" : false)).map((c) => c.agent));
const KIND_TITLE: Record<Crawler["kind"], string> = { answers: "AI search & answers", training: "AI training", search: "Search engines" };

export function buildRobots(blocked: Set<string>, privatePaths: string[], sitemap: string): string {
  const lines = ["# robots.txt — made with https://www.trypopulr.in/tools/robots-txt-generator", ""];
  const named = CRAWLERS.filter((c) => blocked.has(c.agent));
  if (named.length) {
    lines.push(`# Kept out entirely: ${[...new Set(named.map((c) => c.kind))].map((k) => KIND_TITLE[k]).join(", ")}`);
    for (const c of named) lines.push(`User-agent: ${c.agent}`);
    lines.push("Disallow: /", "");
  }
  lines.push("# Everyone else", "User-agent: *");
  if (privatePaths.length) for (const p of privatePaths) lines.push(`Disallow: ${p}`);
  else lines.push("Allow: /");
  if (sitemap) lines.push("", `Sitemap: ${sitemap}`);
  return lines.join("\n") + "\n";
}

const cleanPath = (p: string) => { const t = p.trim(); return !t ? "" : t.startsWith("/") ? t : `/${t}`; };

export default function RobotsGenerator() {
  const [preset, setPreset] = useState<Preset | "custom">("search-only");
  const [blocked, setBlocked] = useState<Set<string>>(blockedBy("search-only"));
  const [paths, setPaths] = useState("/admin\n/cart\n/checkout");
  const [site, setSite] = useState("");
  const [copied, setCopied] = useState(false);

  const privatePaths = useMemo(() => [...new Set(paths.split("\n").map(cleanPath).filter(Boolean))].slice(0, 30), [paths]);
  const sitemap = useMemo(() => {
    const s = site.trim();
    if (!s) return "";
    try { return new URL("/sitemap.xml", /^https?:\/\//i.test(s) ? s : `https://${s}`).toString(); } catch { return ""; }
  }, [site]);
  const text = useMemo(() => buildRobots(blocked, privatePaths, sitemap), [blocked, privatePaths, sitemap]);
  const groups = useMemo(() => parseRobots(text), [text]);
  const samplePath = privatePaths[0];

  const choose = (p: Preset) => { setPreset(p); setBlocked(blockedBy(p)); };
  const toggle = (agent: string) => { const next = new Set(blocked); if (next.has(agent)) next.delete(agent); else next.add(agent); setBlocked(next); setPreset("custom"); };
  const searchBlocked = CRAWLERS.filter((c) => c.kind === "search" && blocked.has(c.agent));
  const answersBlocked = CRAWLERS.filter((c) => c.kind === "answers" && blocked.has(c.agent));

  return (
    <div className="tl-tool">
      <div className="rb-presets" role="radiogroup" aria-label="Start from">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={preset === p.id} className={"rb-preset" + (preset === p.id ? " on" : "")} onClick={() => choose(p.id)}>
            <b>{p.label}</b><span>{p.note}</span>
          </button>
        ))}
      </div>

      <div className="tl-split">
        <div className="tl-form one">
          <label>Your website (for the Sitemap line)<input value={site} onChange={(e) => setSite(e.target.value)} placeholder="yourbusiness.com" inputMode="url" spellCheck={false} /></label>
          <label>Private paths — kept out for every crawler, one per line<textarea rows={4} value={paths} onChange={(e) => setPaths(e.target.value)} spellCheck={false} /></label>
          {(["answers", "training", "search"] as const).map((kind) => (
            <fieldset key={kind} className="rb-group">
              <legend>{KIND_TITLE[kind]}</legend>
              {CRAWLERS.filter((c) => c.kind === kind).map((c) => {
                const allowed = verdictFor(groups, c.agent, "/").allowed;
                return (
                  <label key={c.agent} className="rb-row">
                    <input type="checkbox" checked={!blocked.has(c.agent)} onChange={() => toggle(c.agent)} />
                    <span><code>{c.agent}</code> <small>{c.owner} — {c.purpose}</small></span>
                    <em className={"tl-pill " + (allowed ? "on" : "off")}>{allowed ? "Allowed" : "Blocked"}</em>
                  </label>
                );
              })}
            </fieldset>
          ))}
        </div>

        <div className="tl-output">
          <div className="dv-code">
            <div className="dv-code-head">
              <span className="dv-code-label">robots.txt</span>
              <button className="dv-copybtn" onClick={() => navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>{copied ? "Copied" : "Copy"}</button>
            </div>
            <pre>{text}</pre>
          </div>
          {searchBlocked.length > 0 && <p className="tl-verdict bad">This keeps {searchBlocked.map((c) => c.agent).join(" and ")} out — your site disappears from {searchBlocked.some((c) => c.agent === "Googlebot") ? "Google" : "Bing and Copilot"}. Are you sure?</p>}
          {!searchBlocked.length && answersBlocked.length > 0 && <p className="tl-verdict bad">AI assistants that use {answersBlocked.map((c) => c.agent).join(", ")} won&apos;t be able to find or cite your site.</p>}
          {samplePath && <p className="ck-hint">Check: <code>{samplePath}</code> is {verdictFor(groups, "Googlebot", samplePath).allowed ? "open" : "closed"} to Google, and the home page is {verdictFor(groups, "Googlebot", "/").allowed ? "open" : "closed"}.</p>}
          <p className="ck-hint">Save it as <code>robots.txt</code> at your site&apos;s root — <code>public/robots.txt</code> in most frameworks — then check it with the <a href="/tools/ai-crawler-checker">AI crawler checker</a>.</p>
        </div>
      </div>
    </div>
  );
}
