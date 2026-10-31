import { ogCard, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og-card";

export const alt = "Link preview checker — Populr";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogCard({ eyebrow: "Free tool", title: "See how your link looks when it's shared", sub: "WhatsApp, LinkedIn, X and Slack — and what to fix when the picture's missing." });
}
