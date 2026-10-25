import type { ReactNode } from "react";
import { url } from "@/lib/seo";
import { findFreeTool, FREE_TOOLS, toolPath } from "@/lib/tools/catalog";

// The frame every free tool sits in: the site header, the tool itself, a written explanation
// of what it checks and why, questions, the other tools, and a way into Populr.
//
// The explanation is the part search engines rank and the part people link to. A tool page
// that is only a form is a thin page; one that explains the subject properly is the best
// answer to the search that found it.

export type Faq = { q: string; a: string };

const ld = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

export function ToolHeader() {
  return (
    <header className="ck-top">
      <a href="/" className="ck-logo">Populr<span>.</span></a>
      <nav aria-label="Main" className="ck-links">
        <a href="/tools">Free tools</a>
        <a href="/guides">Guides</a>
        <a href="/developers" className="tl-hide-sm">Developers</a>
        <a href="/app" className="ck-pill">Get started</a>
      </nav>
    </header>
  );
}

export function ToolFooter() {
  return (
    <footer className="ck-foot">
      <a href="/">Populr</a> — the AI CMO for small businesses. <a href="/tools">Free tools</a> · <a href="/check">SEO check</a> · <a href="/guides">Guides</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
    </footer>
  );
}

export default function ToolPage({ slug, eyebrow, h1, sub, tool, children, faq }: {
  slug: string;
  eyebrow: string;
  h1: string;
  sub: string;
  tool: ReactNode;
  children: ReactNode;
  faq: Faq[];
}) {
  const info = findFreeTool(slug)!;
  const canonical = url(toolPath(slug));
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebApplication",
        "@id": `${canonical}#app`,
        name: info.name,
        url: canonical,
        description: info.description,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        browserRequirements: "Requires JavaScript",
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        publisher: { "@id": url("/#organization") },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Populr", item: url("/") },
          { "@type": "ListItem", position: 2, name: "Free tools", item: url("/tools") },
          { "@type": "ListItem", position: 3, name: info.name, item: canonical },
        ],
      },
      ...(faq.length ? [{
        "@type": "FAQPage",
        "@id": `${canonical}#faq`,
        mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
      }] : []),
    ],
  };
  const others = FREE_TOOLS.filter((t) => t.slug !== slug);

  return (
    <div className="dv">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld(graph) }} />
      <main className="ck tl">
        <ToolHeader />
        <nav aria-label="Breadcrumb" className="tl-crumbs">
          <a href="/">Populr</a><span aria-hidden="true">/</span><a href="/tools">Free tools</a><span aria-hidden="true">/</span><span aria-current="page">{info.name}</span>
        </nav>

        <section className="ck-hero tl-hero">
          <p className="ck-eyebrow"><i aria-hidden="true" />{eyebrow}</p>
          <h1>{h1}</h1>
          <p className="ck-sub">{sub}</p>
          {tool}
        </section>

        <article className="tl-article">{children}</article>

        {faq.length > 0 && (
          <section className="ck-faq" aria-labelledby="faq">
            <h2 id="faq">Questions</h2>
            {faq.map((f) => <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>)}
          </section>
        )}

        <section aria-labelledby="more" className="tl-more">
          <h2 id="more">More free tools</h2>
          <div className="tl-cards">
            <a className="tl-card" href="/check"><b>SEO &amp; AI visibility check</b><span>Fourteen checks on your whole home page, with a score you can share.</span></a>
            {others.map((t) => (
              <a key={t.slug} className="tl-card" href={toolPath(t.slug)}><b>{t.name}</b><span>{t.blurb}</span></a>
            ))}
          </div>
        </section>

        <section className="ck-cta">
          <div>
            <h2>Rather have it fixed for you?</h2>
            <p>Populr reads your site, fixes titles, descriptions, structured data and llms.txt, and keeps them fixed as the site changes. Developers can switch it on from VS Code or Cursor.</p>
          </div>
          <div className="ck-cta-btns">
            <a className="ck-btn lime" href="/check">Check my whole site</a>
            <a className="ck-btn ghost" href="/app">Start free</a>
          </div>
        </section>

        <ToolFooter />
      </main>
    </div>
  );
}
