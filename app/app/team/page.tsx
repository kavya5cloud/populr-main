"use client";

import { useEffect, useState } from "react";
import { workspaceId } from "@/lib/store";

// The AI team, in one place.
//
// Nine agents run once a day for every business with a profile. Until now the only trace
// of that work was a log line on a server. This shows each agent's latest job, why it did
// it, how confident it was, and when — all derived from the stored task log, so nothing on
// the page is a number the work doesn't support. An agent that has not run says so; it
// does not get a placeholder that looks like activity.

type Status = "idle" | "running" | "waiting_approval" | "paused" | "completed" | "failed";
type Task = { id: string; agent: string; task: string; reasoning: string; confidence: number; outputs: string[]; status: Status; completedAt: number | null; startedAt: number };
type Summary = { agent: string; name: string; role: string; status: Status; completed: number; failed: number; awaitingApproval: number; avgConfidence: number | null; lastActiveAt: number | null; currentTask: Task | null };
type Payload = {
  ok: boolean; ran: boolean; lastPassAt: number | null;
  roster: { id: string; name: string; role: string; responsibilities: string[] }[];
  agents: Summary[];
  totals?: { completedTasks: number; failedTasks: number; awaitingApproval: number };
  completed: Task[];
  waitingApproval: Task[];
};

const STATUS_LABEL: Record<Status, string> = {
  idle: "Not run yet", running: "Working", waiting_approval: "Needs you", paused: "Paused", completed: "Done", failed: "Failed",
};

function ago(at: number | null): string {
  if (!at) return "never";
  const m = Math.round((Date.now() - at) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export default function TeamPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    fetch(`/api/agents/team?wsid=${encodeURIComponent(workspaceId())}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: Payload) => { if (d?.ok) setData(d); else setErr(true); })
      .catch(() => setErr(true));
  }, []);

  const byAgent = new Map((data?.agents ?? []).map((a) => [a.agent, a]));
  const latestFor = (id: string) => (data?.completed ?? []).find((t) => t.agent === id) ?? byAgent.get(id)?.currentTask ?? null;

  return (
    <div className="appui">
      <div className="team-wrap">
        <div className="asst-top">
          <a href="/app">← Back to dashboard</a>
          <span className="app-wordmark">Populr.</span>
        </div>

        <header className="team-head">
          <h1>Your marketing team</h1>
          <p>
            Nine agents work on your business once a day, each with one job.{" "}
            {data ? (data.lastPassAt ? <>They last ran <strong>{ago(data.lastPassAt)}</strong>.</> : <>They haven&apos;t run yet — the first pass happens once your business profile is set up.</>) : null}
          </p>
        </header>

        {err && <div className="cmp-err" role="alert">Couldn&apos;t load the team just now. Refresh to try again.</div>}

        {data?.ran && data.totals && (
          <dl className="team-totals">
            <div><dt>Jobs done</dt><dd>{data.totals.completedTasks}</dd></div>
            <div><dt>Waiting on you</dt><dd className={data.totals.awaitingApproval ? "need" : ""}>{data.totals.awaitingApproval}</dd></div>
            <div><dt>Failed</dt><dd>{data.totals.failedTasks}</dd></div>
          </dl>
        )}

        {!data && !err && <p className="team-quiet">Loading your team…</p>}

        {data && (
          <section className="team-grid" aria-label="Agents">
            {data.roster.map((r) => {
              const s = byAgent.get(r.id);
              const status: Status = s?.status ?? "idle";
              const t = latestFor(r.id);
              return (
                <article key={r.id} className={"team-card " + status}>
                  <div className="team-card-top">
                    <div>
                      <h2>{r.name}</h2>
                      <p className="team-role">{r.role}</p>
                    </div>
                    <span className={"team-pill " + status}>{STATUS_LABEL[status]}</span>
                  </div>

                  {t ? (
                    <div className="team-last">
                      <p className="team-task">{t.task}</p>
                      <p className="team-why">{t.reasoning}</p>
                      {t.outputs.length > 0 && (
                        <ul className="team-outputs">{t.outputs.slice(0, 3).map((o, i) => <li key={i}>{o}</li>)}</ul>
                      )}
                    </div>
                  ) : (
                    <p className="team-none">Hasn&apos;t done anything yet. Responsible for: {r.responsibilities.slice(0, 3).join(", ").toLowerCase()}.</p>
                  )}

                  <div className="team-foot">
                    <span>{s?.lastActiveAt ? ago(s.lastActiveAt) : "—"}</span>
                    {s?.avgConfidence != null && (
                      <span className="team-conf" title="Average confidence, from the evidence the agent actually had">
                        <span className="team-conf-bar" aria-hidden="true"><span style={{ width: `${Math.round(s.avgConfidence * 100)}%` }} /></span>
                        {Math.round(s.avgConfidence * 100)}% confident
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        )}

        {data?.ran && data.completed.length > 0 && (
          <section className="team-log" aria-label="Recent work">
            <h2>Recent work</h2>
            <ol>
              {data.completed.slice(0, 12).map((t) => (
                <li key={t.id}>
                  <span className="team-log-who">{data.roster.find((r) => r.id === t.agent)?.name ?? t.agent}</span>
                  <span className="team-log-what">{t.task}</span>
                  <span className="team-log-when">{ago(t.completedAt ?? t.startedAt)}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </div>
  );
}
