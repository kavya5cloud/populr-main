import type { Metadata } from "next";
import { findFreeTool } from "@/lib/tools/catalog";
import ToolPage, { type Faq } from "../_components/ToolPage";
import CrawlerChecker from "./CrawlerChecker";
import { OG_DEFAULTS } from "@/lib/seo";

const tool = findFreeTool("ai-crawler-checker")!;

export const metadata: Metadata = {
  title: tool.title,
  description: tool.description,
  alternates: { canonical: "/tools/ai-crawler-checker" },
  openGraph: { ...OG_DEFAULTS, title: tool.title, description: tool.description, url: "/tools/ai-crawler-checker", type: "website" },
};

const FAQ: Faq[] = [
  { q: "If I block GPTBot, will my business disappear from ChatGPT?", a: "No. GPTBot only collects pages to train OpenAI's models. Whether ChatGPT search can find and link your pages is decided by OAI-SearchBot. You can block one and allow the other." },
  { q: "Does blocking Google-Extended hurt my Google ranking?", a: "No. Google-Extended isn't a crawler — it's a name in robots.txt that controls whether your content is used for Gemini. Google says it doesn't affect inclusion or ranking in Google Search. AI Overviews come from Googlebot's crawl." },
  { q: "My robots.txt allows everything, but an AI assistant still can't read my site. Why?", a: "Something in front of the site may be blocking it — a firewall or CDN setting such as Cloudflare's AI bot blocking turns crawlers away before robots.txt is ever read. This tool reads robots.txt only, so check those settings too." },
  { q: "Do AI crawlers actually obey robots.txt?", a: "OpenAI, Anthropic, Google, Apple, Perplexity and Common Crawl all document that their crawlers follow it. It's a request, not a lock, though: it doesn't stop anyone determined to ignore it." },
  { q: "How soon does a change take effect?", a: "Crawlers re-read robots.txt regularly — Google generally within a day. A page that was blocked still has to be crawled again before an assistant can use it." },
];

export default function Page() {
  return (
    <ToolPage
      slug="ai-crawler-checker"
      eyebrow="Free · reads your robots.txt · no sign-up"
      h1="Can ChatGPT, Claude and Perplexity read your site?"
      sub="Check your robots.txt against the crawlers behind AI search and AI models — sixteen of them, each with the exact rule that lets it in or keeps it out."
      tool={<CrawlerChecker />}
      faq={FAQ}
    >
      <p className="tl-callout">We ran this check on India&apos;s 500 biggest <code>.in</code> websites. <a href="/research/ai-crawlers-india">See who blocks ChatGPT, Claude and Perplexity — and who blocks Google</a>.</p>

      <h2>Two kinds of AI crawler, and why the difference matters</h2>
      <p>Every big AI company runs more than one crawler. One collects pages to <em>train</em> its models. Another finds pages to show and link when someone asks the assistant a question. They have different names, and robots.txt treats each name separately.</p>
      <p>That split is the whole point of this check. Blocking a training crawler is a reasonable choice — your text stays out of the next model. Blocking a search crawler is usually an accident, and it has a cost: the assistant can no longer find your pages, so it can't recommend or cite you.</p>
      <table>
        <thead><tr><th>Company</th><th>Finds pages for answers</th><th>Collects pages for training</th></tr></thead>
        <tbody>
          <tr><td>OpenAI</td><td><code>OAI-SearchBot</code>, <code>ChatGPT-User</code></td><td><code>GPTBot</code></td></tr>
          <tr><td>Anthropic</td><td><code>Claude-SearchBot</code>, <code>Claude-User</code></td><td><code>ClaudeBot</code></td></tr>
          <tr><td>Perplexity</td><td><code>PerplexityBot</code>, <code>Perplexity-User</code></td><td>—</td></tr>
          <tr><td>Google</td><td><code>Googlebot</code> (Search and AI Overviews)</td><td><code>Google-Extended</code> (Gemini)</td></tr>
          <tr><td>Apple</td><td><code>Applebot</code> (Siri, Spotlight)</td><td><code>Applebot-Extended</code></td></tr>
        </tbody>
      </table>

      <h2>How robots.txt decides</h2>
      <p>The rules are standard (RFC 9309), and this checker follows them the way the crawlers do:</p>
      <ul>
        <li><b>A crawler obeys one group.</b> If a group names it — <code>User-agent: GPTBot</code> — it follows that group and ignores the <code>*</code> group completely. Only if nothing names it does it fall back to <code>*</code>.</li>
        <li><b>The longest matching rule wins.</b> <code>Allow: /blog/</code> beats <code>Disallow: /</code> for pages under /blog/. When an Allow and a Disallow are the same length, Allow wins.</li>
        <li><b><code>*</code> matches anything, <code>$</code> marks the end.</b> <code>Disallow: /*.pdf$</code> blocks PDFs and nothing else.</li>
        <li><b>A robots.txt that errors blocks everything.</b> If the file returns a server error, crawlers assume they're not allowed in. A missing file (404) means the opposite: no rules at all.</li>
      </ul>

      <h2>Let assistants in, keep training out</h2>
      <p>If you want ChatGPT, Claude and Perplexity to find and cite your business but would rather your content didn&apos;t train their models, say exactly that:</p>
      <pre className="tl-pre">{`User-agent: GPTBot
User-agent: ClaudeBot
User-agent: Google-Extended
User-agent: Applebot-Extended
User-agent: CCBot
Disallow: /

User-agent: *
Allow: /`}</pre>
      <p>The search and answer crawlers aren&apos;t named in the first group, so they follow the <code>*</code> group and read everything.</p>

      <h2>The mistakes we see most</h2>
      <ul>
        <li><b>A staging robots.txt shipped to production.</b> <code>User-agent: *</code> with <code>Disallow: /</code> keeps every crawler out — Google included.</li>
        <li><b>Blocking &quot;all AI&quot; in one go.</b> Lists copied from the internet often include <code>OAI-SearchBot</code> and <code>PerplexityBot</code> alongside the training crawlers, which removes the business from AI answers along with the training data.</li>
        <li><b>A firewall that disagrees with robots.txt.</b> CDN and hosting settings can block AI crawlers before they read a single rule. If the check above says &quot;Allowed&quot; and an assistant still can&apos;t see you, look there.</li>
      </ul>
      <p>Being readable is the first step. To be <em>recommended</em>, an assistant also needs to understand what you are — that&apos;s what <a href="/tools/schema-markup-generator">structured data</a> and an <a href="/tools/llms-txt-generator">llms.txt</a> are for. The <a href="/check">full check</a> looks at all of it at once.</p>
    </ToolPage>
  );
}
