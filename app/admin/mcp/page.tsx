"use client";

import { useEffect, useState } from "react";

// /admin/mcp — are developers using Populr's MCP server to get real work done?
// Read top to bottom: keys made → used → connected → called a tool → fetched approved fixes
// → verified them live. The last step is the one that means "it worked".

type Summary = {
  days: number;
  keys: { total: number; used: number; workspaces: number; createdInWindow: number } | null;
  funnel: { workspacesConnected: number; workspacesCalledATool: number; workspacesFetchedFixes: number; workspacesVerifiedLive: number };
  daily: { day: string; workspaces: number; toolCalls: number; toolErrors: number; keylessCalls: number }[];
  tools: { tool: string; calls: number; workspaces: number; outcomes: Record<string, number> }[];
  clients: { client: string; workspaces: number }[];
};

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

export default function McpUsage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Summary | null>(null);
  const [state, setState] = useState<"loading" | "forbidden" | "error" | "ok">("loading");

  useEffect(() => {
    setState("loading");
    fetch(`/api/admin/mcp-usage?days=${days}`, { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 403) return setState("forbidden");
        if (!r.ok) return setState("error");
        setData(await r.json());
        setState("ok");
      })
      .catch(() => setState("error"));
  }, [days]);

  const f = data?.funnel;
  const steps = data && f ? [
    { label: "Keys created", sub: `in ${data.days} days`, n: data.keys?.createdInWindow ?? null },
    { label: "Keys ever used", sub: `of ${data.keys?.total ?? "—"} keys`, n: data.keys?.used ?? null },
    { label: "Workspaces connected", sub: "any call with a key", n: f.workspacesConnected },
    { label: "Called a tool", sub: "", n: f.workspacesCalledATool },
    { label: "Fetched approved fixes", sub: "get_seo_fixes", n: f.workspacesFetchedFixes },
    { label: "Verified live", sub: "verify_page → live", n: f.workspacesVerifiedLive },
  ] : [];

  return (
    <div className="appui">
      <main className="mu">
        <header className="mu-head">
          <div>
            <p className="mu-eyebrow">Admin</p>
            <h1>MCP usage</h1>
            <p className="mu-sub">Counts only — no keys, tool inputs or results. Workspaces are one-way hashed.</p>
          </div>
          <div className="mu-range" role="group" aria-label="Window">
            {[7, 30, 90].map((d) => (
              <button key={d} className={d === days ? "on" : ""} onClick={() => setDays(d)}>{d} days</button>
            ))}
          </div>
        </header>

        {state === "forbidden" && <p className="mu-note">Admins only. Sign in with an account listed in ADMIN_EMAILS.</p>}
        {state === "error" && <p className="mu-note">Couldn&apos;t load usage. Try again in a moment.</p>}
        {state === "loading" && <div className="mu-skel" aria-busy="true" />}

        {state === "ok" && data && (
          <>
            <section className="mu-funnel" aria-label="Funnel">
              {steps.map((s, i) => (
                <div key={s.label} className="mu-step">
                  <span className="mu-n">{s.n ?? "—"}</span>
                  <span className="mu-l">{s.label}</span>
                  <span className="mu-s">{s.sub || (i > 0 && steps[i - 1].n !== null && s.n !== null ? `${pct(s.n, steps[i - 1].n!)} of previous` : "")}</span>
                </div>
              ))}
            </section>

            <section className="mu-card">
              <h2>Tools</h2>
              {data.tools.length === 0 ? <p className="mu-empty">No tool calls yet.</p> : (
                <table className="mu-table">
                  <thead><tr><th>Tool</th><th>Calls</th><th>Workspaces</th><th>Outcomes</th></tr></thead>
                  <tbody>
                    {data.tools.map((t) => (
                      <tr key={t.tool}>
                        <td><code>{t.tool}</code></td><td>{t.calls}</td><td>{t.workspaces}</td>
                        <td className="mu-outcomes">{Object.entries(t.outcomes).sort((a, b) => b[1] - a[1]).map(([o, n]) => <span key={o} className={/error/.test(o) ? "bad" : o === "live" || o === "ok" || o === "ready" || o === "saved" ? "good" : ""}>{o} {n}</span>)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <div className="mu-two">
              <section className="mu-card">
                <h2>By day</h2>
                {data.daily.length === 0 ? <p className="mu-empty">Nothing in this window.</p> : (
                  <table className="mu-table">
                    <thead><tr><th>Day</th><th>Workspaces</th><th>Tool calls</th><th>Errors</th><th>No key</th></tr></thead>
                    <tbody>
                      {[...data.daily].reverse().map((d) => (
                        <tr key={d.day}><td>{d.day}</td><td>{d.workspaces}</td><td>{d.toolCalls}</td><td>{d.toolErrors || ""}</td><td>{d.keylessCalls || ""}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="mu-foot">&ldquo;No key&rdquo; is directories and editors listing the tools before connecting.</p>
              </section>
              <section className="mu-card">
                <h2>Editors</h2>
                {data.clients.length === 0 ? <p className="mu-empty">No editor has connected yet.</p> : (
                  <table className="mu-table">
                    <thead><tr><th>Client</th><th>Workspaces</th></tr></thead>
                    <tbody>{data.clients.map((c) => <tr key={c.client}><td>{c.client}</td><td>{c.workspaces}</td></tr>)}</tbody>
                  </table>
                )}
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
