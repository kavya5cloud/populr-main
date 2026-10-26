// Which sites let AI search and AI training crawlers in — measured from each site's own
// robots.txt, read with the same code as the AI crawler checker (lib/tools/robots.ts).
//
//   node scripts/research/ai-crawlers.ts <list.csv> <out.json> <list id> <list date>
//
// <list.csv> is "rank,domain" lines (we use the Tranco list, which researchers use because
// it's hard to manipulate and anyone can download the same one). For each domain this
// fetches /robots.txt — and /llms.txt, since the two answer the same question — once,
// eight sites at a time, identifying itself. Nothing else is requested.
//
// How a robots.txt is counted follows RFC 9309, as crawlers do:
//   found        a robots.txt: its rules decide, crawler by crawler
//   missing      404/410: no rules, everything is allowed
//   html         a web page served at /robots.txt (common on some government sites):
//                crawlers find no rules in it, so everything is allowed
//   forbidden    401/403/429 to us: we couldn't read it, so it isn't counted either way
//   unreachable  no answer, or a server error: not counted (crawlers would stay out)

import { readFileSync, writeFileSync } from "node:fs";
import { CRAWLERS, parseRobots, verdictFor } from "../../lib/tools/robots.ts";

const [listPath, outPath, listId, listDate] = process.argv.slice(2);
if (!listPath || !outPath || !listId || !listDate) {
  console.error("usage: node scripts/research/ai-crawlers.ts <list.csv> <out.json> <list id> <list date>");
  process.exit(1);
}

const UA = "PopulrResearch/1.0 (+https://www.trypopulr.in/research/ai-crawlers-india)";
type Status = "found" | "missing" | "html" | "forbidden" | "unreachable";
type Site = { rank: number; domain: string; group: "government" | "education" | "other"; robots: Status; blocked: string[]; blockAll: boolean; namesAi: boolean; llms: boolean; note?: string };

const groupOf = (d: string): Site["group"] =>
  /\.(gov|nic)\.in$/.test(d) || /^(gov|nic)\.in$/.test(d) ? "government" : /\.(ac|edu|res)\.in$/.test(d) ? "education" : "other";

const looksHtml = (type: string, body: string) => /text\/html/i.test(type) || /^\s*(<!doctype|<html|<head|<body)/i.test(body);

// Why a fetch failed, in a word: a domain with no website (no DNS) isn't the same finding as
// a site that's down.
let lastError = "";
const reason = (e: unknown): string => {
  const c = (e as { cause?: { code?: string; message?: string }; name?: string })?.cause;
  if ((e as { name?: string })?.name === "TimeoutError") return "timeout";
  if (c?.code === "ENOTFOUND" || c?.code === "EAI_AGAIN") return "no-dns";
  if (c?.code === "ECONNREFUSED" || c?.code === "ECONNRESET" || c?.code === "UND_ERR_SOCKET") return "refused";
  if (c?.code && /CERT|SSL|TLS/i.test(c.code + (c.message ?? ""))) return "tls";
  return c?.code ?? "error";
};

async function get(url: string, timeoutMs = 12_000): Promise<{ status: number; type: string; text: string; url: string } | null> {
  try {
    const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": UA, Accept: "text/plain,*/*;q=0.5" }, signal: AbortSignal.timeout(timeoutMs) });
    const text = (await r.text()).slice(0, 500_000);
    return { status: r.status, type: r.headers.get("content-type") ?? "", text, url: r.url };
  } catch (e) {
    lastError = reason(e);
    return null;
  }
}

async function robotsFor(domain: string): Promise<{ r: Awaited<ReturnType<typeof get>>; why: string }> {
  const whys: string[] = [];
  for (const base of [`https://${domain}`, `https://www.${domain}`, `http://${domain}`]) {
    const r = await get(`${base}/robots.txt`, TIMEOUT);
    if (r) return { r, why: "" };
    whys.push(lastError);
  }
  return { r: null, why: whys.includes("no-dns") && whys.every((w) => w === "no-dns") ? "no-dns" : whys.find((w) => w !== "no-dns") ?? "error" };
}

const TIMEOUT = Number(process.env.TIMEOUT_MS ?? 12_000);

const AI_NAMES = CRAWLERS.filter((c) => c.kind !== "search").map((c) => c.agent.toLowerCase());

async function check(rank: number, domain: string): Promise<Site> {
  const site: Site = { rank, domain, group: groupOf(domain), robots: "unreachable", blocked: [], blockAll: false, namesAi: false, llms: false };
  const { r, why } = await robotsFor(domain);
  let origin = `https://${domain}`;
  if (!r) site.note = why;
  if (r) {
    if (r.status >= 500 || [401, 403, 429].includes(r.status)) site.note = `HTTP ${r.status}`;
    try { origin = new URL(r.url).origin; } catch { /* keep the guess */ }
    if (r.status >= 500) site.robots = "unreachable";
    else if ([401, 403, 429].includes(r.status)) site.robots = "forbidden";
    else if (r.status >= 400) site.robots = "missing";
    else if (looksHtml(r.type, r.text)) site.robots = "html";
    else {
      site.robots = "found";
      const groups = parseRobots(r.text);
      site.blocked = CRAWLERS.filter((c) => !verdictFor(groups, c.agent, "/").allowed).map((c) => c.agent);
      site.blockAll = !verdictFor(groups, "SomeNewCrawler", "/").allowed;
      site.namesAi = groups.some((g) => g.agents.some((a) => AI_NAMES.includes(a)));
    }
  }
  const l = await get(`${origin}/llms.txt`);
  site.llms = !!l && l.status === 200 && !looksHtml(l.type, l.text) && /^\s*#\s+\S/.test(l.text);
  return site;
}

const rows = readFileSync(listPath, "utf8").trim().split("\n").map((line) => {
  const [rank, domain] = line.split(",");
  return { rank: Number(rank), domain: domain.trim() };
});

const out: Site[] = new Array(rows.length);
let next = 0, done = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (next < rows.length) {
    const i = next++;
    out[i] = await check(rows[i].rank, rows[i].domain);
    if (++done % 50 === 0) console.error(`${done}/${rows.length}`);
  }
}));

writeFileSync(outPath, JSON.stringify({
  study: "ai-crawlers-india",
  list: { source: "Tranco", id: listId, created: listDate, url: `https://tranco-list.eu/list/${listId}/1000000`, selection: `The top ${rows.length} .in domains, by Tranco rank` },
  checkedAt: new Date().toISOString(),
  crawlers: CRAWLERS.map(({ agent, owner, kind }) => ({ agent, owner, kind })),
  sites: out,
}, null, 1) + "\n");
console.error(`wrote ${outPath}`);
