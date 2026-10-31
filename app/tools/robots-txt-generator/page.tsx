import type { Metadata } from "next";
import { findFreeTool } from "@/lib/tools/catalog";
import ToolPage, { type Faq } from "../_components/ToolPage";
import RobotsGenerator from "./RobotsGenerator";
import { OG_DEFAULTS } from "@/lib/seo";

const tool = findFreeTool("robots-txt-generator")!;

export const metadata: Metadata = {
  title: tool.title,
  description: tool.description,
  alternates: { canonical: "/tools/robots-txt-generator" },
  openGraph: { ...OG_DEFAULTS, title: tool.title, description: tool.description, url: "/tools/robots-txt-generator", type: "website" },
};

const FAQ: Faq[] = [
  { q: "Does robots.txt keep a page out of Google?", a: "Not reliably. It stops crawling, not indexing: a blocked page can still be listed if other sites link to it, just without a description. To keep a page out of results, let it be crawled and add a noindex tag instead." },
  { q: "Should I block AI crawlers?", a: "Block the ones that collect training data if you'd rather your writing didn't train future models. Think twice before blocking the search and answer crawlers — OAI-SearchBot, Claude-SearchBot, PerplexityBot — because that's how assistants find and recommend you." },
  { q: "Where does robots.txt go?", a: "At the root of your domain: yourbusiness.com/robots.txt. In Next.js, Vite, Astro and most frameworks, put it in public/; in SvelteKit and Hugo, in static/. A robots.txt in a subfolder is ignored." },
  { q: "What happens if robots.txt is missing?", a: "Nothing bad: crawlers treat a missing file (a 404) as permission to read everything. A robots.txt that errors (a 5xx) is worse — crawlers stay away until it answers." },
  { q: "Why are blocked crawlers in their own group?", a: "A crawler obeys only the group that names it. Naming the crawlers you block in one group, and leaving everyone else to the * group, means your private paths apply to everyone who's allowed in — and nothing you meant to block slips through." },
];

export default function Page() {
  return (
    <ToolPage
      slug="robots-txt-generator"
      eyebrow="Free · AI crawler presets · no sign-up"
      h1="robots.txt generator, with AI crawlers built in"
      sub="Pick who may read your site — search engines, AI search, AI training — add the paths that should stay private, and get a robots.txt that does exactly that, checked line by line."
      tool={<RobotsGenerator />}
      faq={FAQ}
    >
      <h2>What robots.txt does — and doesn&apos;t</h2>
      <p>robots.txt is a short text file at the root of your site that tells crawlers which parts they may read. Search engines and the major AI companies follow it. It&apos;s a request, not a lock: it keeps well-behaved crawlers out of your admin pages and away from content you don&apos;t want used, but it doesn&apos;t hide anything from a person, and it doesn&apos;t stop a crawler that ignores it.</p>

      <h2>The choice most businesses should make about AI</h2>
      <p>AI companies run separate crawlers for search and for training. The search ones decide whether ChatGPT, Claude and Perplexity can find your pages when someone asks for a business like yours. The training ones decide whether your text helps train the next model. You can say yes to the first and no to the second — that&apos;s the &quot;AI search yes, AI training no&quot; preset above, and the choice that keeps you in AI answers without donating your content.</p>
      <p>When we checked <a href="/research/ai-crawlers-india">India&apos;s 500 biggest <code>.in</code> websites</a>, almost all of them let AI search in — and the ones that made a deliberate choice mostly blocked training while leaving search open.</p>

      <h2>Mistakes that cost traffic</h2>
      <ul>
        <li><b><code>Disallow: /</code> under <code>User-agent: *</code></b> — often left over from a staging site. It keeps out every crawler, Google included.</li>
        <li><b>Blocking CSS and JavaScript folders.</b> Google renders pages to understand them; blocking <code>/assets</code> or <code>/_next</code> can make your pages look broken to it.</li>
        <li><b>Using robots.txt to hide a page.</b> It stays findable through links. Use <code>noindex</code> for that.</li>
        <li><b>Forgetting the Sitemap line.</b> It&apos;s how crawlers that don&apos;t know your site yet find every page.</li>
      </ul>
      <p>Already have a robots.txt? Check what it actually allows with the <a href="/tools/ai-crawler-checker">AI crawler checker</a>.</p>
    </ToolPage>
  );
}
