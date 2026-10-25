import { ogCard, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og-card";

export const alt = "llms.txt generator — Populr";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogCard({ eyebrow: "Free tool", title: "Generate an llms.txt for your website", sub: "Built from your sitemap and your pages' own titles and descriptions. Nothing made up." });
}
