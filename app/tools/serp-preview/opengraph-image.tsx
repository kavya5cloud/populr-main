import { ogCard, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og-card";

export const alt = "Google result preview — Populr";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogCard({ eyebrow: "Free tool", title: "See your page the way Google shows it", sub: "Title and description measured in pixels, with where Google cuts them off." });
}
