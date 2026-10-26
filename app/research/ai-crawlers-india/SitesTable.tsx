"use client";

import { useMemo, useState } from "react";
import type { StudySite } from "@/lib/research/ai-crawlers-india";

// Every site in the study, searchable — so a reader can look up their own, or check ours.

const STATUS: Record<StudySite["robots"], string> = {
  found: "robots.txt",
  missing: "No robots.txt",
  html: "Web page instead",
  forbidden: "Refused us",
  unreachable: "Didn't answer",
};

type Filter = "all" | "blocks-search" | "blocks-training" | "llms" | "unread";

export default function SitesTable({ sites, answers, training }: { sites: StudySite[]; answers: string[]; training: string[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(50);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return sites.filter((s) => {
      if (needle && !s.domain.includes(needle)) return false;
      if (filter === "blocks-search") return answers.some((a) => s.blocked.includes(a));
      if (filter === "blocks-training") return training.some((a) => s.blocked.includes(a));
      if (filter === "llms") return s.llms;
      if (filter === "unread") return s.robots === "forbidden" || s.robots === "unreachable";
      return true;
    });
  }, [sites, q, filter, answers, training]);

  return (
    <div className="rs-table-wrap">
      <div className="rs-controls">
        <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(50); }} placeholder="Find a site, e.g. irctc" aria-label="Find a site" spellCheck={false} />
        <select value={filter} onChange={(e) => { setFilter(e.target.value as Filter); setLimit(50); }} aria-label="Show">
          <option value="all">All {sites.length} sites</option>
          <option value="blocks-search">Block AI search crawlers</option>
          <option value="blocks-training">Block AI training crawlers</option>
          <option value="llms">Have an llms.txt</option>
          <option value="unread">Couldn&apos;t be read</option>
        </select>
      </div>
      <div className="rs-table" role="table" aria-label="Sites in the study">
        <div className="rs-tr rs-th" role="row">
          <span role="columnheader">Rank</span><span role="columnheader">Site</span><span role="columnheader">robots.txt</span><span role="columnheader">AI search</span><span role="columnheader">AI training</span><span role="columnheader">llms.txt</span>
        </div>
        {shown.slice(0, limit).map((s) => {
          const a = answers.filter((x) => s.blocked.includes(x)).length;
          const t = training.filter((x) => s.blocked.includes(x)).length;
          const unread = s.robots === "forbidden" || s.robots === "unreachable";
          return (
            <div className="rs-tr" role="row" key={s.domain}>
              <span role="cell" className="rs-num">{s.rank.toLocaleString("en-IN")}</span>
              <span role="cell" className="rs-dom">{s.domain}</span>
              <span role="cell" className="rs-dim">{STATUS[s.robots]}</span>
              <span role="cell">{unread ? "—" : a ? <b className="rs-bad">{a === answers.length ? "All blocked" : `${a} blocked`}</b> : "Open"}</span>
              <span role="cell">{unread ? "—" : t ? <b className="rs-warn">{t === training.length ? "All blocked" : `${t} blocked`}</b> : "Open"}</span>
              <span role="cell">{s.llms ? "Yes" : ""}</span>
            </div>
          );
        })}
        {!shown.length && <p className="rs-empty">No site matches.</p>}
      </div>
      {shown.length > limit && <button className="ck-btn tl-light rs-more" onClick={() => setLimit(limit + 100)}>Show more ({shown.length - limit} left)</button>}
    </div>
  );
}
