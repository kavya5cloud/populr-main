import type { Metadata } from "next";
import { findFreeTool } from "@/lib/tools/catalog";
import ToolPage, { type Faq } from "../_components/ToolPage";
import LlmsGenerator from "./LlmsGenerator";

const tool = findFreeTool("llms-txt-generator")!;

export const metadata: Metadata = {
  title: tool.title,
  description: tool.description,
  alternates: { canonical: "/tools/llms-txt-generator" },
  openGraph: { title: tool.title, description: tool.description, url: "/tools/llms-txt-generator", type: "website" },
};

const FAQ: Faq[] = [
  { q: "What is llms.txt?", a: "A plain-text file at the root of a website — yoursite.com/llms.txt — that tells AI assistants what the site is and which pages matter, in Markdown. It was proposed at llmstxt.org in 2024, and documentation sites, software companies and small businesses publish one." },
  { q: "Does llms.txt replace robots.txt or my sitemap?", a: "No. robots.txt says which crawlers may read what; the sitemap lists every page for search engines. llms.txt is a short, readable summary for language models. Keep all three." },
  { q: "Do ChatGPT and Claude actually read it?", a: "It's a proposed convention, not a standard any company has promised to follow. Some AI coding tools and agents read it today, and it costs nothing to publish — so it's worth having, but not worth paying for." },
  { q: "Where do the descriptions come from?", a: "From your own pages: each one's title and meta description, as your site serves them. Nothing is written by AI. If a description is missing or weak, fix it on the page — then it improves in search results too." },
  { q: "How often should I update it?", a: "Whenever you add or remove an important page. Run the generator again, compare, and replace the file." },
];

export default function Page() {
  return (
    <ToolPage
      slug="llms-txt-generator"
      eyebrow="Free · built from your own pages · no sign-up"
      h1="Generate an llms.txt for your website"
      sub="Enter your site. We read its sitemap and up to twenty pages, and build the llms.txt from their own titles and descriptions — nothing made up. Edit it, then save it at your site's root."
      tool={<LlmsGenerator />}
      faq={FAQ}
    >
      <h2>What goes in an llms.txt</h2>
      <p>The format, from <a href="https://llmstxt.org" rel="noopener" target="_blank">llmstxt.org</a>, is Markdown with a fixed shape. That shape is what lets a model read it reliably:</p>
      <pre className="tl-pre">{`# Rao's Bakery

> Fresh bread, cakes and custom orders in Koregaon Park, Pune.

## Pages

- [Menu](https://raosbakery.in/menu): Breads, cakes and pastries, with prices
- [Custom cakes](https://raosbakery.in/custom-cakes): Order a cake for a date
- [Visit us](https://raosbakery.in/visit): Address, hours and parking

## Blog

- [How we make sourdough](https://raosbakery.in/blog/sourdough): Our 36-hour method`}</pre>
      <ul>
        <li><b>An H1 with the site&apos;s name</b> — the only required line.</li>
        <li><b>A one-line summary</b> as a blockquote: what the business is, and where.</li>
        <li><b>Sections of links</b>, each with a short note on what the page holds.</li>
      </ul>
      <p>The generator names the site from its own <code>og:site_name</code> or home page title, takes the summary from the home page&apos;s meta description, and groups pages into sections by folder — /blog/ pages under Blog, and so on.</p>

      <h2>Why it&apos;s written from your pages, not by AI</h2>
      <p>An llms.txt tells an assistant what your pages say. If a model wrote the descriptions, the file would describe your site in words your site doesn&apos;t use — and an assistant that trusts it would repeat claims you never made. So every description here is the page&apos;s own meta description. Where a page has none, it&apos;s listed by title alone, and that&apos;s a signal worth acting on: a page with no description is a page search engines describe for you too. The <a href="/tools/serp-preview">result preview</a> helps you write one.</p>

      <h2>Make it count</h2>
      <ul>
        <li><b>Put it at the root.</b> It has to be at <code>/llms.txt</code> on your main domain. In Next.js, Astro, Vite and most other frameworks, that&apos;s <code>public/llms.txt</code>; in SvelteKit and Hugo, <code>static/llms.txt</code>.</li>
        <li><b>Keep it short.</b> It&apos;s a map, not a copy of the site. Your most useful pages, with a line each.</li>
        <li><b>Let the crawlers in.</b> A perfect llms.txt does nothing if robots.txt blocks the assistants — the <a href="/tools/ai-crawler-checker">AI crawler checker</a> shows whether it does.</li>
        <li><b>Say who you are in structured data too.</b> llms.txt is read by some tools; schema.org markup is read by search engines everywhere. The <a href="/tools/schema-markup-generator">schema markup generator</a> builds it.</li>
      </ul>
      <p>For the background, read <a href="/guides/what-is-llms-txt">what llms.txt is and who reads it</a>.</p>
    </ToolPage>
  );
}
