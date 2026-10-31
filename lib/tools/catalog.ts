// The free tools at /tools — one list, read by the hub, the sitemap, each page's "more
// tools" links and its metadata, so none of them can drift from the others.
//
// Each tool answers something people actually search for, does it properly, and asks for
// nothing — no sign-up, no email. They're how most people will first meet Populr, so they
// have to be worth using on their own.

export type FreeTool = {
  slug: string;
  /** What it's called on the page and in links. */
  name: string;
  /** The <title>. Under ~50 characters: " — Populr" is added after it. */
  title: string;
  /** The meta description: 140–160 characters, a promise of what the page does. */
  description: string;
  /** One line for the hub and the "more tools" cards. */
  blurb: string;
};

export const FREE_TOOLS: FreeTool[] = [
  {
    slug: "ai-crawler-checker",
    name: "AI crawler checker",
    title: "AI Crawler Checker: Is ChatGPT Blocked?",
    description: "See whether your robots.txt lets ChatGPT, Claude, Perplexity and Gemini read your site — crawler by crawler, with the exact rule that decides each. Free.",
    blurb: "Does your robots.txt let ChatGPT, Claude and Perplexity in? Crawler by crawler, with the rule that decides.",
  },
  {
    slug: "llms-txt-generator",
    name: "llms.txt generator",
    title: "Free llms.txt Generator for Any Website",
    description: "Make an llms.txt from your site's own sitemap and page titles in seconds — the file AI assistants read to understand a website. Free, no sign-up.",
    blurb: "Build an llms.txt from your sitemap and page titles — the map of your site AI assistants read.",
  },
  {
    slug: "schema-markup-generator",
    name: "Schema markup generator",
    title: "Local Business Schema Markup Generator",
    description: "Generate JSON-LD structured data for your business — name, address, hours, phone and FAQs — ready to paste into your site's <head>. Free, nothing to install.",
    blurb: "JSON-LD for your business — address, hours, phone, FAQs — ready to paste into your site.",
  },
  {
    slug: "link-preview-checker",
    name: "Link preview checker",
    title: "Link Preview Checker for WhatsApp & LinkedIn",
    description: "See how your link looks when it's shared on WhatsApp, LinkedIn, X and Slack — and fix a missing image, a cut-off title or a broken preview. Free.",
    blurb: "How your link looks on WhatsApp, LinkedIn, X and Slack — and what to fix when the picture's missing.",
  },
  {
    slug: "robots-txt-generator",
    name: "robots.txt generator",
    title: "robots.txt Generator with AI Crawler Rules",
    description: "Build a robots.txt in seconds: let AI search crawlers in, keep training crawlers out, block private paths — and see what each crawler will do. Free.",
    blurb: "Let AI search in, keep training out, block private paths — and see what each crawler will do.",
  },
  {
    slug: "serp-preview",
    name: "Google result preview",
    title: "SERP Preview & Title Length Checker",
    description: "See how your title and meta description will look on Google before you publish. Measures pixel width, not just characters, and shows where Google cuts off.",
    blurb: "See your title and description as Google shows them, and where they get cut off.",
  },
];

export const toolPath = (slug: string) => `/tools/${slug}`;
export const findFreeTool = (slug: string) => FREE_TOOLS.find((t) => t.slug === slug);
