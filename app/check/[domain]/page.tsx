import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DOMAIN_RE, type Check } from "@/lib/check/checks";
import { checkStore } from "@/lib/check/store";
import { CheckForm, CopySnippet, RunCheck, ShareBar } from "../CheckClient";
import { OG_DEFAULTS } from "@/lib/seo";

// /check/<domain> — one site's result, made to be shared: a score with every point
// explained, a share bar, and a way to fix it. Not indexed: these are pages about other
// people's websites, and a list of them in search results would be thin and unwelcome.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ domain: string }> };

async function load(raw: string) {
  const domain = decodeURIComponent(raw).toLowerCase();
  if (!DOMAIN_RE.test(domain) || domain.length > 253) return null;
  return { domain, result: await checkStore().get(domain).catch(() => null) };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const got = await load((await params).domain);
  if (!got) return { title: "Not found", robots: { index: false } };
  const { domain, result } = got;
  const title = result ? `${domain} scores ${result.score}/100 for SEO & AI readiness` : `SEO & AI check for ${domain}`;
  const description = result
    ? `${result.passed} of ${result.total} checks passed. See what Google and AI assistants can read on ${domain} — and check your own site free.`
    : `Check ${domain} for SEO and AI readiness, free.`;
  return {
    title,
    description,
    robots: { index: false, follow: true },
    alternates: { canonical: `/check/${domain}` },
    openGraph: { ...OG_DEFAULTS, title, description, url: `/check/${domain}`, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

function Row({ c }: { c: Check }) {
  return (
    <li className={`ck-row ${c.passed ? "pass" : "fail"}`}>
      <span className="ck-mark" aria-label={c.passed ? "Passed" : "Failed"}>{c.passed ? "✓" : "✕"}</span>
      <div className="ck-row-body">
        <div className="ck-row-top"><b>{c.label}</b><span className="ck-pts">{c.passed ? `+${c.points}` : `0 / ${c.points}`}</span></div>
        <p className="ck-detail">{c.detail}</p>
        {!c.passed && <p className="ck-fix">{c.fix}</p>}
      </div>
    </li>
  );
}

export default async function CheckResultPage({ params }: Props) {
  const got = await load((await params).domain);
  if (!got) notFound();
  const { domain, result } = got;

  return (
    <div className="dv">
      <main className="ck">
        <header className="ck-top">
          <a href="/" className="ck-logo">Populr<span>.</span></a>
          <nav aria-label="Main" className="ck-links">
            <a href="/check">Check a site</a>
            <a href="/developers">Developers</a>
            <a href="/app" className="ck-pill">Get started</a>
          </nav>
        </header>

        {!result ? (
          <section className="ck-hero">
            <p className="ck-eyebrow"><i aria-hidden="true" />SEO & AI readiness</p>
            <h1>{domain} hasn&apos;t been checked yet</h1>
            <p className="ck-sub">It takes about ten seconds.</p>
            <RunCheck domain={domain} label={`Check ${domain}`} />
          </section>
        ) : (
          <>
            <section className="ck-score">
              <div className="ck-ring" style={{ ["--pct" as string]: `${result.score}`, ["--tone" as string]: result.score >= 75 ? "#9bd33a" : result.score >= 50 ? "#e8b923" : "#e2643f" }} aria-label={`Score ${result.score} out of 100`}>
                <span className="ck-ring-n">{result.score}</span>
                <span className="ck-ring-of">/ 100</span>
              </div>
              <div className="ck-score-copy">
                <p className="ck-eyebrow"><i aria-hidden="true" />SEO & AI readiness · grade {result.grade}</p>
                <h1>{domain}</h1>
                <p className="ck-sub">{result.passed} of {result.total} checks passed. Checked {new Date(result.checkedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}.</p>
                <ShareBar domain={domain} score={result.score} />
              </div>
            </section>

            <section className="ck-cta">
              <div>
                <h2>{result.score >= 90 ? "Keep it that way." : `Fix the ${result.total - result.passed} that failed — without touching code.`}</h2>
                <p>Populr drafts every fix, you approve it, and it goes live: through a one-line snippet, or your coding agent applies it in your site&apos;s code.</p>
              </div>
              <div className="ck-cta-btns">
                <a className="ck-btn lime" href={`/app?url=${encodeURIComponent(result.url)}`}>Fix my site with Populr</a>
                <a className="ck-btn ghost" href="/developers">Use my coding agent</a>
              </div>
            </section>

            <div className="ck-groups">
              {(["search", "ai"] as const).map((g) => {
                const rows = result.checks.filter((c) => c.group === g);
                const earned = rows.filter((c) => c.passed).reduce((n, c) => n + c.points, 0);
                return (
                  <section key={g} className="ck-group">
                    <h2>{g === "search" ? "Search basics" : "AI & sharing readiness"} <span>{earned} / 50</span></h2>
                    <ul>{[...rows].sort((a, b) => Number(a.passed) - Number(b.passed)).map((c) => <Row key={c.id} c={c} />)}</ul>
                  </section>
                );
              })}
            </div>

            {result.score >= 75 && (
              <section className="ck-badge">
                <h2>Show it off</h2>
                <p>Scored {result.score}? Add the badge to your site&apos;s footer.</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/check/${domain}/badge.svg`} alt={`SEO & AI ready — ${result.score}/100, checked by Populr`} width={210} height={28} />
                <CopySnippet code={`<a href="https://www.trypopulr.in/check/${domain}"><img src="https://www.trypopulr.in/check/${domain}/badge.svg" alt="SEO & AI ready — checked by Populr" width="210" height="28"></a>`} />
              </section>
            )}

            <section className="ck-again">
              <h2>Check another site</h2>
              <p>A competitor, a client, your other business.</p>
              <CheckForm cta="Check it" />
              <RunCheck domain={domain} label={`Re-check ${domain}`} />
            </section>
          </>
        )}

        <footer className="ck-foot">
          Scores count the checks a site passes; each check shows what we found. <a href="/check">How it works</a> · <a href="/">Populr</a>
        </footer>
      </main>
    </div>
  );
}
