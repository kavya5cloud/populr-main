import { ogCard, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og-card";

export const alt = "robots.txt generator — Populr";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogCard({ eyebrow: "Free tool", title: "robots.txt, with AI crawlers built in", sub: "Let AI search in, keep training out, block private paths — checked line by line." });
}
