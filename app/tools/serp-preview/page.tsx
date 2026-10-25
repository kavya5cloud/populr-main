import type { Metadata } from "next";
import { findFreeTool } from "@/lib/tools/catalog";
import ToolPage, { type Faq } from "../_components/ToolPage";
import SerpPreview from "./SerpPreview";

const tool = findFreeTool("serp-preview")!;

export const metadata: Metadata = {
  title: tool.title,
  description: tool.description,
  alternates: { canonical: "/tools/serp-preview" },
  openGraph: { title: tool.title, description: tool.description, url: "/tools/serp-preview", type: "website" },
};

const FAQ: Faq[] = [
  { q: "How long should a title tag be?", a: "Short enough to fit about 600 pixels — usually 50 to 60 characters. Pixels are what count: a title full of wide letters like W and M gets cut sooner than one of narrow letters." },
  { q: "How long should a meta description be?", a: "About 120 to 155 characters. Google shows roughly two lines on desktop and cuts longer ones; on phones it shows less, so put the important part first." },
  { q: "Why did Google show a different title than mine?", a: "Google rewrites titles it thinks don't describe the page well — ones stuffed with keywords, too long, the same on every page, or that don't match the main heading. A clear, specific title that matches the page is the one that survives." },
  { q: "Do titles and descriptions affect ranking?", a: "The title is one of the strongest on-page signals. The description isn't a ranking factor, but it's your pitch in the results: it decides whether people click." },
  { q: "Is the preview exact?", a: "It measures your text with Arial at the sizes Google uses on desktop and cuts at the commonly measured limits. Google changes its layout from time to time, so treat a few pixels either side as close enough." },
];

export default function Page() {
  return (
    <ToolPage
      slug="serp-preview"
      eyebrow="Free · measures pixels, not just characters"
      h1="See your page the way Google shows it"
      sub="Type a title and meta description and see the search result as it will appear — measured in pixels, the way Google decides where to cut — with advice on what to change."
      tool={<SerpPreview />}
      faq={FAQ}
    >
      <h2>Why pixels, not characters</h2>
      <p>Google doesn&apos;t count characters. It fits your title into a box about 600 pixels wide and cuts what doesn&apos;t fit, adding an ellipsis. &quot;Illustrated little lists&quot; and &quot;MEGA WAREHOUSE MOWERS&quot; have nearly the same number of letters and very different widths. Character limits are a rule of thumb; this preview measures your actual text in the font Google uses.</p>

      <h2>Writing a title that earns the click</h2>
      <ul>
        <li><b>Lead with what the page is.</b> &quot;Custom Birthday Cakes in Pune&quot; before &quot;Rao&apos;s Bakery&quot;. People scan the first few words, and so does Google.</li>
        <li><b>One page, one title.</b> Every page needs its own. A site where every page is titled &quot;Home | Business&quot; gives Google nothing to tell them apart.</li>
        <li><b>Your name at the end, if it fits.</b> &quot;| Rao&apos;s Bakery&quot; builds recognition, but it&apos;s the first thing to cut when space runs out.</li>
        <li><b>Match the page.</b> A title promising something the page doesn&apos;t deliver gets rewritten by Google, and earns a quick bounce from whoever clicked.</li>
      </ul>

      <h2>Writing a description</h2>
      <p>The description doesn&apos;t move rankings, but it&apos;s the sentence that sells the click. Say plainly what someone gets from the page, include one concrete detail — a price, an area served, an hour — and skip &quot;Welcome to our website&quot;. If you leave it out, Google picks a passage from the page for you, which may not be the one you&apos;d choose.</p>

      <h2>Then check the live page</h2>
      <p>The preview shows what you mean to publish. To see what your live site actually serves — titles, descriptions, structured data and more on your home page — run the <a href="/check">free SEO &amp; AI check</a>. And if writing titles for every page sounds like a chore, that&apos;s what <a href="/">Populr</a> does: it drafts them from each page&apos;s own content and keeps them right.</p>
    </ToolPage>
  );
}
