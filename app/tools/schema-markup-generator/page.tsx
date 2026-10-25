import type { Metadata } from "next";
import { findFreeTool } from "@/lib/tools/catalog";
import ToolPage, { type Faq } from "../_components/ToolPage";
import SchemaGenerator from "./SchemaGenerator";

const tool = findFreeTool("schema-markup-generator")!;

export const metadata: Metadata = {
  title: tool.title,
  description: tool.description,
  alternates: { canonical: "/tools/schema-markup-generator" },
  openGraph: { title: tool.title, description: tool.description, url: "/tools/schema-markup-generator", type: "website" },
};

const FAQ: Faq[] = [
  { q: "What is schema markup?", a: "Code in a page's <head>, in the schema.org vocabulary, that states facts about the page in a form machines read without guessing: this is a bakery, this is its address, these are its hours. Google, Bing and AI assistants all read it. JSON-LD is the format Google recommends." },
  { q: "Will this get me rich results or stars in Google?", a: "Markup makes a page eligible; Google decides what to show. Business details can feed the knowledge panel and local results. Star ratings need real reviews marked up on the page — never add ratings you don't have, which is a reason for a manual penalty." },
  { q: "Where do I paste it?", a: "In the <head> of your home page. On WordPress, Wix, Shopify or Squarespace, use the setting for header code (often Settings → Custom code). In Next.js, render it in your root layout with a script tag of type application/ld+json." },
  { q: "My site already has some JSON-LD. Should I add this too?", a: "Don't add a second copy of the same type — two conflicting LocalBusiness blocks are worse than one. Replace the old one, or merge the fields." },
  { q: "Which business type should I pick?", a: "The most specific one that's true. A café is a Restaurant; a shop is a Store; an accountant is a ProfessionalService. If customers don't visit a physical place, use Organization." },
];

export default function Page() {
  return (
    <ToolPage
      slug="schema-markup-generator"
      eyebrow="Free · JSON-LD · nothing to install"
      h1="Schema markup generator for your business"
      sub="Fill in what's true about your business and get schema.org JSON-LD to paste into your site — the structured data Google and AI assistants read to know who you are, where, and when you're open."
      tool={<SchemaGenerator />}
      faq={FAQ}
    >
      <h2>What this markup does</h2>
      <p>A search engine reading your home page sees text. It can probably work out that you&apos;re a bakery in Pune, but &quot;probably&quot; is the problem. Structured data removes the guess: it states, in a vocabulary every search engine shares, that this page belongs to a <code>Restaurant</code> named Rao&apos;s Bakery, at this address, open these hours, with these profiles elsewhere.</p>
      <p>That matters more now than it used to. AI assistants answering &quot;a good bakery near Koregaon Park&quot; are assembling facts about businesses, and the ones they can read without guessing are the ones they can state with confidence.</p>

      <h2>What the generator produces</h2>
      <ul>
        <li><b>Your business</b> — <code>LocalBusiness</code> or the more specific type you pick, with only the fields you filled in. An empty field is left out, never filled with a placeholder.</li>
        <li><b>Your website</b> — a <code>WebSite</code> entry linked to the business, so search engines connect the two.</li>
        <li><b>Your questions</b> — an <code>FAQPage</code> block, if you add any. Put it on the home page only: the same questions marked up on every page is duplicate markup.</li>
      </ul>

      <h2>Getting the details right</h2>
      <ul>
        <li><b>Opening hours</b> use schema.org&apos;s short form: two-letter days, 24-hour times. <code>Mo-Sa 09:00-21:00</code> is Monday to Saturday, 9am to 9pm. Add a line for each different pattern.</li>
        <li><b>Your profiles</b> — Instagram, Facebook, LinkedIn, your Google Maps listing — go in <code>sameAs</code>. They tell search engines that these accounts and this website are the same business.</li>
        <li><b>The phone number</b> should match your Google Business Profile exactly, including the country code. Consistent details across the web are a local ranking signal.</li>
        <li><b>The logo</b> should be a square PNG or JPG of at least 112×112 pixels; Google often rejects SVG logos.</li>
      </ul>

      <h2>After you paste it</h2>
      <p>Test the page in Google&apos;s Rich Results Test, then give it time — Google picks up structured data the next time it crawls the page. If your details change, update the markup the same day: markup that contradicts the page is worse than none.</p>
      <p>Structured data tells search engines who you are; your <a href="/tools/serp-preview">title and description</a> are what people actually see. And if you want assistants to read the rest of your site, check <a href="/tools/ai-crawler-checker">they&apos;re allowed in</a>.</p>
    </ToolPage>
  );
}
