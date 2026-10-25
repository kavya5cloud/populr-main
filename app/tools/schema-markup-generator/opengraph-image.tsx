import { ogCard, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og-card";

export const alt = "Schema markup generator — Populr";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogCard({ eyebrow: "Free tool", title: "Schema markup for your business, ready to paste", sub: "JSON-LD with your address, hours, phone and FAQs — what Google and AI assistants read." });
}
