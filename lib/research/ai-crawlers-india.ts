import raw from "./ai-crawlers-india.json";

// The study "Which of India's top websites let AI assistants in?" — the data, and every
// number the page states, computed from it. The page never types a figure by hand: if the
// study is re-run (scripts/research/ai-crawlers.ts), the page follows the data.

export type Group = "government" | "education" | "other";
export type RobotsStatus = "found" | "missing" | "html" | "forbidden" | "unreachable";
export type StudySite = { rank: number; domain: string; group: Group; robots: RobotsStatus; blocked: string[]; blockAll: boolean; namesAi: boolean; llms: boolean; note?: string };
export type StudyCrawler = { agent: string; owner: string; kind: "answers" | "training" | "search" };
export type Study = {
  study: string;
  list: { source: string; id: string; created: string; url: string; selection: string };
  checkedAt: string;
  crawlers: StudyCrawler[];
  sites: StudySite[];
};

export const STUDY = raw as Study;
export const STUDY_PATH = "/research/ai-crawlers-india";

/** Sites whose robots.txt we could read (or that have none): the ones a finding can be about. */
export const readable = (s: StudySite) => s.robots === "found" || s.robots === "missing" || s.robots === "html";

export function studyStats(study: Study = STUDY) {
  const all = study.sites;
  const read = all.filter(readable);
  const kind = (k: StudyCrawler["kind"]) => study.crawlers.filter((c) => c.kind === k).map((c) => c.agent);
  const answers = kind("answers"), training = kind("training");
  const blocksAny = (s: StudySite, agents: string[]) => agents.some((a) => s.blocked.includes(a));
  const byRank = (a: StudySite, b: StudySite) => a.rank - b.rank;

  const unreadReasons = new Map<string, number>();
  for (const s of all.filter((x) => !readable(x))) {
    const why = s.note?.startsWith("HTTP 403") ? "Refused our checker (HTTP 403)"
      : s.note?.startsWith("HTTP 5") ? "Server error (HTTP 5xx)"
      : s.note === "no-dns" ? "No website at the domain"
      : s.note === "tls" ? "Certificate error"
      : /timeout|TIMEOUT|ETIMEDOUT/.test(s.note ?? "") ? "Timed out"
      : "Other connection error";
    unreadReasons.set(why, (unreadReasons.get(why) ?? 0) + 1);
  }

  const group = (g: Group) => {
    const sites = all.filter((s) => s.group === g);
    const r = sites.filter(readable);
    return {
      total: sites.length,
      found: sites.filter((s) => s.robots === "found").length,
      missing: sites.filter((s) => s.robots === "missing").length,
      html: sites.filter((s) => s.robots === "html").length,
      unread: sites.length - r.length,
      readable: r.length,
      blockAnswers: r.filter((s) => blocksAny(s, answers)).length,
      blockTraining: r.filter((s) => blocksAny(s, training)).length,
    };
  };

  return {
    total: all.length,
    readable: read.length,
    found: read.filter((s) => s.robots === "found").length,
    missing: read.filter((s) => s.robots === "missing").length,
    html: read.filter((s) => s.robots === "html").length,
    unread: all.length - read.length,
    unreadReasons: [...unreadReasons].sort((a, b) => b[1] - a[1]),
    blockAnyAnswers: read.filter((s) => blocksAny(s, answers)).sort(byRank),
    blockAllAnswers: read.filter((s) => answers.every((a) => s.blocked.includes(a))).sort(byRank),
    blockAnyTraining: read.filter((s) => blocksAny(s, training)).sort(byRank),
    trainingOnly: read.filter((s) => blocksAny(s, training) && !blocksAny(s, answers)).sort(byRank),
    blockGoogle: read.filter((s) => s.blocked.includes("Googlebot")).sort(byRank),
    /** Block an AI search crawler while letting Google in: a decision about AI, not about crawlers in general. */
    singleOutAi: read.filter((s) => blocksAny(s, answers) && !s.blocked.includes("Googlebot")).sort(byRank),
    namesAi: read.filter((s) => s.namesAi).length,
    llms: all.filter((s) => s.llms).sort(byRank),
    perCrawler: study.crawlers.map((c) => ({ ...c, blocked: read.filter((s) => s.blocked.includes(c.agent)).length })),
    groups: { government: group("government"), education: group("education"), other: group("other") },
  };
}

export const pct = (n: number, of: number) => `${of ? Math.round((n / of) * 1000) / 10 : 0}%`;

/** The dataset as CSV, for download. One row per site. */
export function studyCsv(study: Study = STUDY): string {
  const head = ["rank", "domain", "group", "robots_txt", "blocked_crawlers", "blocks_unknown_crawlers", "names_ai_crawlers", "has_llms_txt", "note"];
  const cell = (v: string | number | boolean) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = study.sites.map((s) => [s.rank, s.domain, s.group, s.robots, s.blocked.join(" "), s.blockAll, s.namesAi, s.llms, s.note ?? ""].map(cell).join(","));
  return [head.join(","), ...rows].join("\n") + "\n";
}
