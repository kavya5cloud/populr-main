import type { Metadata } from "next";
import { url } from "@/lib/seo";
import { FREE_TOOLS, toolPath } from "@/lib/tools/catalog";
import { ToolFooter, ToolHeader } from "./_components/ToolPage";

export const metadata: Metadata = {
  title: "Free SEO & AI Search Tools",
  description: "Free tools to get found on Google and in ChatGPT, Claude and Perplexity: an SEO check, AI crawler checker, llms.txt and schema generators. No sign-up.",
  alternates: { canonical: "/tools" },
  openGraph: { title: "Free SEO & AI Search Tools", url: "/tools", type: "website" },
};

const ALL = [
  { href: "/check", name: "SEO & AI visibility check", blurb: "Fourteen checks on your home page — titles, structured data, llms.txt, AI crawler access, link previews — and a score you can share." },
  ...FREE_TOOLS.map((t) => ({ href: toolPath(t.slug), name: t.name, blurb: t.blurb })),
];

const ld = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  "@id": `${url("/tools")}#page`,
  name: "Free SEO & AI search tools",
  url: url("/tools"),
  isPartOf: { "@id": url("/#website") },
  mainEntity: {
    "@type": "ItemList",
    itemListElement: ALL.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.name, url: url(t.href) })),
  },
};

export default function ToolsHub() {
  return (
    <div className="dv">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
      <main className="ck tl">
        <ToolHeader />
        <section className="ck-hero">
          <p className="ck-eyebrow"><i aria-hidden="true" />Free · no sign-up · no email</p>
          <h1>Free tools to get found on Google — and in AI answers</h1>
          <p className="ck-sub">Search is no longer one box. People ask Google, and they ask ChatGPT, Claude and Perplexity. These check and fix the things all of them read — each one free, and each one useful on its own.</p>
        </section>
        <section aria-label="Tools" className="tl-hub">
          {ALL.map((t) => (
            <a key={t.href} className="tl-card big" href={t.href}><b>{t.name}</b><span>{t.blurb}</span><em aria-hidden="true">Open →</em></a>
          ))}
        </section>
        <section className="tl-article">
          <h2>Where to start</h2>
          <p>Run the <a href="/check">SEO &amp; AI visibility check</a> on your home page first — it covers the basics in ten seconds and tells you which of the other tools you need. If it says AI crawlers are blocked, the <a href="/tools/ai-crawler-checker">AI crawler checker</a> shows which ones and the rule doing it. If you have no structured data or llms.txt, the generators build both from facts you already have.</p>
          <p>We used the AI crawler checker on India&apos;s 500 biggest <code>.in</code> websites — <a href="/research/ai-crawlers-india">read what we found</a>.</p>
          <p>Want the background first? The <a href="/guides">guides</a> explain <a href="/guides/what-is-geo-generative-engine-optimization">how AI search picks businesses</a> and <a href="/guides/what-is-llms-txt">what llms.txt is for</a>.</p>
        </section>
        <section className="ck-cta">
          <div>
            <h2>Rather not do it by hand?</h2>
            <p>Populr runs these checks on your whole site, fixes what they find, and keeps it fixed — or a developer can switch it on from VS Code or Cursor in one click.</p>
          </div>
          <div className="ck-cta-btns">
            <a className="ck-btn lime" href="/app">Start free</a>
            <a className="ck-btn ghost" href="/developers">For developers</a>
          </div>
        </section>
        <ToolFooter />
      </main>
    </div>
  );
}
