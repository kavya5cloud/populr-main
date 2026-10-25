import { ogCard, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og-card";

export const alt = "Free SEO & AI search tools — Populr";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogCard({ eyebrow: "Free tools", title: "Get found on Google — and in AI answers", sub: "A site check, AI crawler checker, llms.txt and schema generators. Free, no sign-up." });
}
