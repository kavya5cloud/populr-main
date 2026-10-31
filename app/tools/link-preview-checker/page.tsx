import type { Metadata } from "next";
import { findFreeTool } from "@/lib/tools/catalog";
import ToolPage, { type Faq } from "../_components/ToolPage";
import PreviewChecker from "./PreviewChecker";
import { OG_DEFAULTS } from "@/lib/seo";

const tool = findFreeTool("link-preview-checker")!;

export const metadata: Metadata = {
  title: tool.title,
  description: tool.description,
  alternates: { canonical: "/tools/link-preview-checker" },
  openGraph: { ...OG_DEFAULTS, title: tool.title, description: tool.description, url: "/tools/link-preview-checker", type: "website" },
};

const FAQ: Faq[] = [
  { q: "Why does my link show no picture on WhatsApp?", a: "Usually one of three things: the page has no og:image tag, the image address doesn't load for an outside visitor, or the image file is large — WhatsApp is widely observed to skip preview images over about 300 KB. The checker above tells you which." },
  { q: "I fixed my tags. Why does the old preview still show?", a: "Apps cache previews. LinkedIn's Post Inspector and Facebook's Sharing Debugger fetch a fresh copy when you inspect the URL. WhatsApp has no refresh button: a new chat, or a slightly different URL (adding ?v=2), gets a fresh preview." },
  { q: "What size should my share image be?", a: "1200×630 pixels, as a PNG or JPG, works on every major app — it's the 1.91:1 shape Facebook and LinkedIn recommend, and X's large card. Keep text away from the edges, which some apps crop." },
  { q: "Do these tags help SEO?", a: "Not rankings directly — but a link with a picture and a clear title gets clicked far more when it's shared, and AI assistants and search engines read the same title and description." },
  { q: "Where do I put the tags?", a: "In the <head> of each page. Most frameworks have a metadata API for it — in Next.js, openGraph and twitter in export const metadata; on WordPress, an SEO plugin sets them." },
];

export default function Page() {
  return (
    <ToolPage
      slug="link-preview-checker"
      eyebrow="Free · WhatsApp, LinkedIn, X, Slack · no sign-up"
      h1="See how your link looks when it's shared"
      sub="Paste any page. See the preview WhatsApp, LinkedIn, X and Slack will show — and exactly what to fix when the picture's missing or the title's cut off."
      tool={<PreviewChecker />}
      faq={FAQ}
    >
      <h2>How a link preview is made</h2>
      <p>When someone pastes your link into WhatsApp or LinkedIn, the app fetches the page and reads a handful of tags in its <code>&lt;head&gt;</code>. Those tags — not your page&apos;s design — decide the picture, the title and the line of text under it. If they&apos;re missing, the app guesses, and the guess is usually a bare link.</p>
      <table>
        <thead><tr><th>What&apos;s shown</th><th>Tag apps read first</th><th>Fallback</th></tr></thead>
        <tbody>
          <tr><td>Title</td><td><code>og:title</code></td><td>the page&apos;s <code>&lt;title&gt;</code></td></tr>
          <tr><td>Text under it</td><td><code>og:description</code></td><td><code>meta description</code></td></tr>
          <tr><td>Picture</td><td><code>og:image</code></td><td>usually none</td></tr>
          <tr><td>Your name</td><td><code>og:site_name</code></td><td>the domain</td></tr>
          <tr><td>X&apos;s card size</td><td><code>twitter:card</code></td><td>a small card</td></tr>
        </tbody>
      </table>

      <h2>The tags to add</h2>
      <pre className="tl-pre">{`<meta property="og:title" content="Custom cakes in Koregaon Park, Pune">
<meta property="og:description" content="Birthday and wedding cakes, baked fresh every morning. Order by 6pm for tomorrow.">
<meta property="og:image" content="https://yourbusiness.com/og/cakes.jpg">
<meta property="og:site_name" content="Rao's Bakery">
<meta property="og:url" content="https://yourbusiness.com/cakes">
<meta name="twitter:card" content="summary_large_image">`}</pre>
      <p>The image address must be a full <code>https://</code> URL that loads for anyone — not a path, and not an image behind a login.</p>

      <h2>Why it matters in India especially</h2>
      <p>Most links to a small business are shared on WhatsApp — in family groups, neighbourhood groups, customer chats. A link that shows a photo and a clear title looks trustworthy and gets tapped; a bare blue link looks like spam. Fixing the preview is ten minutes of work for every share that follows.</p>

      <h2>Then make the page itself findable</h2>
      <p>Previews are what people see when your link is shared. Search engines and AI assistants read the same page for different things — check your <a href="/tools/serp-preview">Google result</a>, your <a href="/tools/schema-markup-generator">structured data</a>, and whether <a href="/tools/ai-crawler-checker">AI crawlers are allowed in</a>. Or run the <a href="/check">full check</a> on your home page.</p>
    </ToolPage>
  );
}
