import { ogCard, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og-card";

export const alt = "AI crawler checker — Populr";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogCard({ eyebrow: "Free tool", title: "Can ChatGPT, Claude and Perplexity read your site?", sub: "Sixteen AI and search crawlers, each with the robots.txt rule that lets it in or keeps it out." });
}
