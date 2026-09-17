"use client";
import { useCallback, useState } from "react";
import { usePoll } from "@/app/components/usePoll";

// Execution Dashboard (Part 9) — the live cockpit for the Job Engine. It seeds a few jobs
// on first load, then polls the real /api/jobs/dashboard: running/queued/completed/failed,
// retry queue, worker health, average duration + cost, provider usage and system load.
// Everything is driven by real job execution.

type Metrics = {
  queued: number; running: number; completed: number; failed: number; retrying: number; deadLetter: number;
  avgDurationMs: number; avgCost: number; concurrency: number; systemLoad: number;
  workers: { id: string; busy: boolean; currentJobId: string | null; processed: number; failed: number }[];
  providerUsage: Record<string, number>;
};
type JobRow = { id: string; type: string; state: string; progress: number; priority: string; cost: number; attempts: number; durationMs: number | null };

const SEED = [
  { type: "video_generation", assetKind: "hero_video" },
  { type: "image_generation", assetKind: "carousel" },
  { type: "document", assetKind: "blog" },
  { type: "ugc", assetKind: "ugc_video" },
  { type: "campaign_planning" },
];
const BRIEF = { objective: "Launch to founders", audience: "founders", keyMessage: "an AI CMO that reasons", emotionalAngle: "calm confidence", proof: "deterministic engine", cta: "join early access", visualDirection: "clean", successMetric: "signups" };

const STATE_CLASS: Record<string, string> = {
  completed: "job-ok", failed: "job-bad", timed_out: "job-bad", cancelled: "job-muted",
  paused: "job-muted", retrying: "job-warn", queued: "job-warn", waiting_for_resources: "job-warn",
};

export default function JobsDashboard() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [seeding, setSeeding] = useState(false);

  // Was a 1s self-rescheduling setTimeout with no visibility check: 3,600 requests an hour
  // from a tab nobody was looking at. 5s is still live for a dashboard, and usePoll stops
  // entirely while the tab is hidden.
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/jobs/dashboard", { cache: "no-store" });
      const d = await r.json();
      setMetrics(d.metrics); setJobs(d.jobs ?? []);
    } catch { /* a missed tick is not a failure; the next one will say */ }
  }, []);
  usePoll(load, 5000);

  // The seeding that used to live here is gone.
  //
  // It POSTed five jobs whenever the dashboard reported zero — and on a serverless platform
  // the engine is per-instance, so a fresh instance always reports zero. Opening this page
  // created real work, which is the opposite of what a read-only cockpit should do.
  const seedDemo = useCallback(async () => {
    setSeeding(true);
    await Promise.all(SEED.map((s) => fetch("/api/jobs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...s, requestType: s.type, brief: BRIEF }),
    }).catch(() => {})));
    await load();
    setSeeding(false);
  }, [load]);

  const m = metrics;
  const tile = (label: string, value: string | number) => (
    <div className="job-tile"><div className="job-tile-v">{value}</div><div className="job-tile-k">{label}</div></div>
  );

  return (
    <section className="st-section lw">
      <header className="st-shead">
        <span className="label">Execution · Jobs</span>
        <h1>Job Orchestration</h1>
        <p>Every AI request runs as a Job through the central engine — Planner → Creative Intelligence → Generation → Creative Director → Approval → Publishing → Learning. Live from real execution.</p>
        {/* Seeding is a deliberate action now. It used to happen on page load whenever the
            dashboard reported zero jobs, which on a fresh serverless instance is always. */}
        <button className="cmp-alt" onClick={seedDemo} disabled={seeding}>
          {seeding ? "Seeding…" : "Seed demo jobs"}
        </button>
      </header>

      {!m ? <div className="st-empty"><p>Connecting to the execution engine…</p></div> : (
        <>
          <div className="job-tiles">
            {tile("Running", m.running)}
            {tile("Queued", m.queued)}
            {tile("Completed", m.completed)}
            {tile("Failed", m.failed)}
            {tile("Retry queue", m.retrying)}
            {tile("Dead-letter", m.deadLetter)}
            {tile("Avg duration", `${Math.round(m.avgDurationMs)}ms`)}
            {tile("Avg cost", `${m.avgCost}`)}
            {tile("System load", `${Math.round(m.systemLoad * 100)}%`)}
          </div>

          <section className="lw-block">
            <h2 className="lw-h2">Worker Health <span className="lw-muted">· concurrency {m.concurrency}</span></h2>
            <div className="lw-chips">
              {m.workers.map((w) => (
                <span key={w.id} className={"lw-chip " + (w.busy ? "job-warn" : "")}>{w.id} · {w.busy ? "busy" : "idle"} · {w.processed} done{w.failed ? ` · ${w.failed} failed` : ""}</span>
              ))}
            </div>
          </section>

          <section className="lw-block">
            <h2 className="lw-h2">Provider Usage</h2>
            <div className="lw-chips">
              {Object.entries(m.providerUsage).length ? Object.entries(m.providerUsage).map(([p, n]) => <span key={p} className="lw-chip">{p} <b className="pub-count">{n}</b></span>) : <span className="lw-muted">No generations yet.</span>}
            </div>
          </section>

          <section className="lw-block">
            <h2 className="lw-h2">Jobs</h2>
            <div className="job-list">
              {jobs.map((j) => (
                <div key={j.id} className="job-row">
                  <span className="job-type">{j.type.replace(/_/g, " ")}</span>
                  <span className={"job-state " + (STATE_CLASS[j.state] ?? "")}>{j.state.replace(/_/g, " ")}</span>
                  <span className="job-bar"><span className="job-bar-fill" style={{ width: `${j.progress}%` }} /></span>
                  <span className="job-meta">{j.progress}%{j.attempts > 1 ? ` · ${j.attempts} tries` : ""}{j.cost ? ` · ${j.cost} cr` : ""}{j.durationMs != null ? ` · ${j.durationMs}ms` : ""}</span>
                </div>
              ))}
              {jobs.length === 0 && <div className="lw-muted">No jobs yet — seeding…</div>}
            </div>
          </section>
        </>
      )}
    </section>
  );
}
