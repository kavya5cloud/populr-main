import { ogCard, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og-card";

export const alt = "Free SEO & AI visibility check — Populr";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogCard({ eyebrow: "Free tool", title: "Can Google — and ChatGPT — find your business?", sub: "14 checks in ten seconds. A score you can share, and a fix for everything that fails." });
}
