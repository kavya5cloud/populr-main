import type { Metadata } from "next";
import { url } from "@/lib/seo";
import { pct, STUDY, STUDY_PATH, studyStats } from "@/lib/research/ai-crawlers-india";
import { CRAWLERS } from "@/lib/tools/robots";
import { ToolFooter, ToolHeader } from "@/app/tools/_components/ToolPage";
import SitesTable from "./SitesTable";

// Every figure on this page is computed from lib/research/ai-crawlers-india.json. None is
// typed by hand, so a re-run of the study can't leave the page saying something stale.

const TITLE = "Do India's Top Websites Let AI In? (2026 Study)";
const DESCRIPTION = "We read the robots.txt of India's 500 biggest .in websites: who blocks ChatGPT, Claude and Perplexity, who blocks Google, and who publishes an llms.txt.";
const PUBLISHED = "2026-10-26";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: STUDY_PATH },
  openGraph: { title: TITLE, description: DESCRIPTION, url: STUDY_PATH, type: "article", publishedTime: PUBLISHED },
};

const s = studyStats();
const answers = STUDY.crawlers.filter((c) => c.kind === "answers").map((c) => c.agent);
const training = STUDY.crawlers.filter((c) => c.kind === "training").map((c) => c.agent);
const purpose = new Map(CRAWLERS.map((c) => [c.agent, c.purpose]));
const checked = new Date(STUDY.checkedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const openShare = pct(s.readable - s.blockAnyAnswers.length, s.readable);
const gov = s.groups.government;
const NAMED_GOV: Record<string, string> = {
  "nha.gov.in": "National Health Authority, which runs Ayushman Bharat",
  "ncrb.gov.in": "National Crime Records Bureau",
  "ireps.gov.in": "Indian Railways' e-procurement system",
  "samsodisha.gov.in": "Odisha's student admissions portal",
};

const canonical = url(STUDY_PATH);
const ld = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "@id": `${canonical}#article`,
      headline: "Do India's top websites let AI assistants in?",
      description: DESCRIPTION,
      datePublished: PUBLISHED,
      dateModified: STUDY.checkedAt.slice(0, 10),
      author: { "@id": url("/#organization") },
      publisher: { "@id": url("/#organization") },
      mainEntityOfPage: canonical,
      image: `${canonical}/opengraph-image`,
      about: { "@id": `${canonical}#dataset` },
    },
    {
      "@type": "Dataset",
      "@id": `${canonical}#dataset`,
      name: "AI crawler access on India's top 500 .in websites",
      description: `For each of the top ${s.total} .in domains in the Tranco list ${STUDY.list.id}: whether its robots.txt lets ${STUDY.crawlers.length} AI and search crawlers read its home page, and whether it publishes an llms.txt. Checked ${checked}.`,
      url: canonical,
      creator: { "@id": url("/#organization") },
      license: "https://creativecommons.org/licenses/by/4.0/",
      isAccessibleForFree: true,
      temporalCoverage: STUDY.checkedAt.slice(0, 10),
      spatialCoverage: { "@type": "Place", name: "India" },
      isBasedOn: STUDY.list.url,
      variableMeasured: ["robots.txt status", "AI search crawlers blocked", "AI training crawlers blocked", "Search crawlers blocked", "llms.txt published"],
      distribution: [
        { "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: url(`${STUDY_PATH}/data.csv`) },
        { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: url(`${STUDY_PATH}/data.json`) },
      ],
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Populr", item: url("/") },
        { "@type": "ListItem", position: 2, name: "AI crawlers and India's top websites", item: canonical },
      ],
    },
  ],
};

export default function Page() {
  return (
    <div className="dv">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
      <main className="ck tl">
        <ToolHeader />
        <nav aria-label="Breadcrumb" className="tl-crumbs">
          <a href="/">Populr</a><span aria-hidden="true">/</span><span aria-current="page">Research: AI crawlers and India&apos;s top websites</span>
        </nav>

        <section className="ck-hero">
          <p className="ck-eyebrow"><i aria-hidden="true" />Research · {checked} · {s.total} websites</p>
          <h1>Do India&apos;s top websites let AI assistants in?</h1>
          <p className="ck-sub">We read the robots.txt of the {s.total} most popular <code>.in</code> websites — government portals, banks, retailers, news sites, universities — and checked it against {STUDY.crawlers.length} crawlers, from ChatGPT&apos;s to Google&apos;s. Almost all of them let AI search in. A few of the biggest don&apos;t, and three national government sites keep out every crawler, Google included.</p>
        </section>

        <section className="rs-stats" aria-label="Key findings">
          <div><b>{openShare}</b><span>of the {s.readable} sites we could read let every AI search crawler in</span></div>
          <div><b>{s.blockAnyAnswers.length}</b><span>block at least one — {s.singleOutAi.length} of them single out AI, led by <strong>amazon.in</strong>, which keeps out ChatGPT search, Claude and Perplexity</span></div>
          <div><b>{s.blockGoogle.length}</b><span>tell every crawler, Googlebot too, not to read their home page</span></div>
          <div><b>{s.llms.length}</b><span>publish an llms.txt — {pct(s.llms.length, s.total)} of the {s.total}</span></div>
        </section>

        <article className="tl-article">
          <h2>AI search is almost entirely open</h2>
          <p>AI companies run two kinds of crawler. One finds pages to show and cite when someone asks the assistant a question; the other collects pages to train models. Blocking the first makes a site invisible to that assistant. Of the {s.readable} sites whose robots.txt we could read, {s.readable - s.blockAnyAnswers.length} block none of the {answers.length} search and answer crawlers, and {s.blockAllAnswers.length} block all of them.</p>
          <table>
            <thead><tr><th>Crawler</th><th>Run by</th><th>What it does</th><th>Blocked by</th></tr></thead>
            <tbody>
              {s.perCrawler.map((c) => (
                <tr key={c.agent}><td><code>{c.agent}</code></td><td>{c.owner}</td><td>{purpose.get(c.agent)}</td><td>{c.blocked} ({pct(c.blocked, s.readable)})</td></tr>
              ))}
            </tbody>
          </table>

          <h2>The sites that block AI search</h2>
          <p>{s.blockAnyAnswers.length} sites block at least one AI search or answer crawler from their home page — but {s.blockAnyAnswers.length - s.singleOutAi.length} of them block every crawler, Google included (more on those below). Only {s.singleOutAi.length} single out AI crawlers while letting Google in. The largest by far is <strong>amazon.in</strong>: its robots.txt gives <code>OAI-SearchBot</code>, <code>Claude-SearchBot</code> and <code>PerplexityBot</code> a <code>Disallow: /</code> of their own, so an assistant asked for a product can&apos;t read Amazon India&apos;s pages to answer.</p>
          <ul className="rs-list">
            {s.singleOutAi.map((x) => (
              <li key={x.domain}><b>{x.domain}</b> <span>#{x.rank.toLocaleString("en-IN")} · blocks {answers.filter((a) => x.blocked.includes(a)).join(", ")}</span></li>
            ))}
          </ul>

          <h2>Training is blocked more often than search</h2>
          <p>{s.blockAnyTraining.length} sites ({pct(s.blockAnyTraining.length, s.readable)}) block at least one crawler that collects training data, against {s.blockAnyAnswers.length} that block a search crawler. {s.trainingOnly.length} of them make the distinction deliberately: they keep training crawlers like <code>GPTBot</code> and <code>CCBot</code> out while letting the search crawlers in — the choice that keeps a site&apos;s content out of future models without disappearing from AI answers. {s.namesAi} sites name at least one AI crawler in their robots.txt at all.</p>

          <h2>The sites that keep out every crawler — three of them national government sites</h2>
          <p>{s.blockGoogle.length} sites answer every crawler — Googlebot included — with <code>Disallow: /</code> on their home page. Most are small or technical domains. Four are government sites — three national, one state:</p>
          <ul className="rs-list">
            {s.blockGoogle.filter((x) => NAMED_GOV[x.domain]).map((x) => (
              <li key={x.domain}><b>{x.domain}</b> <span>{NAMED_GOV[x.domain]}</span></li>
            ))}
          </ul>
          <p>A <code>Disallow: /</code> doesn&apos;t make a site disappear from Google — its address can still be listed if other sites link to it — but no search engine or assistant that follows the rules will read its pages. Someone asking an AI assistant about Ayushman Bharat gets an answer drawn from everyone except the authority that runs it.</p>

          <h2>Most government sites we could read have no robots.txt</h2>
          <p>Of {gov.total} government sites (<code>gov.in</code> and <code>nic.in</code>), {gov.found} publish a robots.txt. {gov.missing} have none, {gov.html} answer <code>/robots.txt</code> with an ordinary web page, and {gov.unread} couldn&apos;t be read at all. A missing or HTML robots.txt isn&apos;t harmful — crawlers treat both as &quot;no rules&quot; — but it means nobody has decided what crawlers should do.</p>
          <table>
            <thead><tr><th></th><th>Sites</th><th>robots.txt</th><th>None</th><th>Web page instead</th><th>Couldn&apos;t read</th><th>Block AI search</th></tr></thead>
            <tbody>
              {(["government", "education", "other"] as const).map((g) => {
                const x = s.groups[g];
                return <tr key={g}><td>{g === "government" ? "Government" : g === "education" ? "Education" : "Business, media & other"}</td><td>{x.total}</td><td>{x.found}</td><td>{x.missing}</td><td>{x.html}</td><td>{x.unread}</td><td>{x.blockAnswers} of {x.readable}</td></tr>;
              })}
            </tbody>
          </table>

          <h2>llms.txt is still rare</h2>
          <p>{s.llms.length} of the {s.total} sites publish an llms.txt — a short map of the site written for AI assistants:</p>
          <p className="rs-tags">{s.llms.map((x) => <span key={x.domain}>{x.domain}</span>)}</p>
          <p>Want one? The <a href="/tools/llms-txt-generator">llms.txt generator</a> builds it from your own sitemap and page descriptions.</p>
        </article>

        <section aria-labelledby="all" className="tl-more">
          <h2 id="all">All {s.total} sites</h2>
          <SitesTable sites={STUDY.sites} answers={answers} training={training} />
        </section>

        <article className="tl-article" aria-labelledby="method">
          <h2 id="method">How we did it</h2>
          <ul>
            <li><b>Which sites.</b> {STUDY.list.selection}, from the <a href={STUDY.list.url} rel="noopener" target="_blank">Tranco list {STUDY.list.id}</a> (generated {STUDY.list.created}). Tranco combines five traffic sources and is built to resist manipulation, which is why researchers use it. Indian brands on <code>.com</code> aren&apos;t included — only <code>.in</code> domains, including <code>gov.in</code>, <code>nic.in</code>, <code>ac.in</code> and <code>co.in</code>.</li>
            <li><b>What we fetched.</b> Each site&apos;s <code>/robots.txt</code> and <code>/llms.txt</code>, once, on {checked}, from India, identifying ourselves as <code>PopulrResearch/1.0</code>. We tried <code>https://</code>, then <code>https://www.</code>, then <code>http://</code>, followed redirects, and retried anything that failed with a longer timeout.</li>
            <li><b>How a robots.txt is read.</b> The way crawlers read it (RFC 9309): a crawler obeys the group that names it, or the <code>*</code> group if none does; the longest matching rule wins. We asked one question per crawler: may it read the home page? It&apos;s the same code as our <a href="/tools/ai-crawler-checker">AI crawler checker</a>, so you can check any result yourself.</li>
            <li><b>What counts.</b> No robots.txt (a 404) and a web page served in its place both mean &quot;no rules&quot;, as they do for crawlers. Findings are out of the {s.readable} sites we could read. The other {s.unread} are left out, because their answer to us says nothing reliable about their answer to a crawler: {s.unreadReasons.map(([why, n]) => `${why.toLowerCase()} (${n})`).join(", ")}.</li>
            <li><b>What it can&apos;t see.</b> robots.txt is a request, not a lock. Firewalls and CDNs can turn crawlers away before they read it, and some crawlers ignore it. This measures what each site asks — not what every crawler does.</li>
          </ul>
          <h2>Use the data</h2>
          <p>Download it as <a href={`${STUDY_PATH}/data.csv`}>CSV</a> or <a href={`${STUDY_PATH}/data.json`}>JSON</a>. It&apos;s free to use under <a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener" target="_blank">CC BY 4.0</a> — cite it as <em>Populr, &quot;Do India&apos;s top websites let AI assistants in?&quot;, {checked}, trypopulr.in{STUDY_PATH}</em>. The script that collected it is <code>scripts/research/ai-crawlers.ts</code> in our repository.</p>
        </article>

        <section className="ck-cta">
          <div>
            <h2>Is your site on the list — or should it be?</h2>
            <p>Check which AI and search crawlers your robots.txt lets in, crawler by crawler, with the exact rule that decides each one.</p>
          </div>
          <div className="ck-cta-btns">
            <a className="ck-btn lime" href="/tools/ai-crawler-checker">Check my site</a>
            <a className="ck-btn ghost" href="/check">Full SEO &amp; AI check</a>
          </div>
        </section>

        <ToolFooter />
      </main>
    </div>
  );
}
