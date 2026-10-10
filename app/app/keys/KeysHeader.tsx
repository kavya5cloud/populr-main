"use client";

import { useEffect, useState } from "react";
import { workspaceId } from "@/lib/store";

// The top of the keys page: three steps that tick off as they actually happen.
//
// Not a decorative stepper — each state is read from Populr: a key exists, a key has been
// used by an editor, and the SEO autopilot has approved fixes waiting to be applied. So the
// page tells a developer exactly where they are, and what's left.

type State = { hasKey: boolean; keyUsed: boolean; approved: number; configured: boolean };

const EDITORS = [
  { name: "Claude Code", glyph: "✳" },
  { name: "Cursor", glyph: "◆" },
  { name: "VS Code", glyph: "⌘" },
  { name: "Windsurf", glyph: "≋" },
];

export default function KeysHeader() {
  const [s, setS] = useState<State | null>(null);

  useEffect(() => {
    const ws = encodeURIComponent(workspaceId());
    const load = () => Promise.all([
      fetch(`/api/mcp/keys?wsid=${ws}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      fetch(`/api/seo/autopilot?wsid=${ws}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null),
    ]).then(([k, a]) => {
      const keys = (k?.keys ?? []) as { lastUsedAt: number | null }[];
      const pages = Object.values((a?.pages ?? {}) as Record<string, { status: string }>);
      setS({ hasKey: keys.length > 0, keyUsed: keys.some((x) => x.lastUsedAt), approved: pages.filter((p) => p.status === "approved").length, configured: !!a?.configured });
    });
    load();
    // Re-read while the page is open, so step 2 ticks the moment an editor first connects.
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, []);

  const steps = [
    { t: "Create a key", d: "Shown once — copy it straight into your editor.", done: !!s?.hasKey },
    { t: "Connect your editor", d: "Ticks when your editor first talks to Populr.", done: !!s?.keyUsed },
    { t: "Ask your assistant", d: s?.approved ? `${s.approved} approved fix${s.approved === 1 ? "" : "es"} ready to apply.` : "Approve a page fix below to give it something to apply.", done: !!s?.approved && !!s?.keyUsed },
  ];
  const current = steps.findIndex((x) => !x.done);

  return (
    <header className="kh">
      <div className="kh-copy">
        <p className="kh-eyebrow"><i aria-hidden="true" />Populr for your code editor</p>
        <h1>Ship your SEO from your editor.</h1>
        <p className="kh-sub">One key connects your coding assistant to Populr. It applies the SEO fixes you approve — in your site&apos;s code, where every search engine and AI crawler reads them.</p>
        <ul className="kh-editors" aria-label="Works with">
          {EDITORS.map((e) => <li key={e.name}><span aria-hidden="true">{e.glyph}</span>{e.name}</li>)}
        </ul>
      </div>

      <div className="kh-side">
        <ol className="kh-steps" aria-label="Progress">
          {steps.map((x, i) => (
            <li key={x.t} className={x.done ? "done" : i === current ? "now" : ""}>
              <span className="kh-mark" aria-hidden="true">{x.done ? "" : i + 1}</span>
              <div><b>{x.t}</b><p>{x.d}</p></div>
            </li>
          ))}
        </ol>
        <div className="kh-term" aria-label="What to ask your assistant">
          <div className="kh-term-bar" aria-hidden="true"><i /><i /><i /></div>
          <p><span>&gt;</span> apply my Populr SEO fixes</p>
        </div>
      </div>
    </header>
  );
}
