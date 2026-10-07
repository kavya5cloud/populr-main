import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og-card";

export const alt = "Populr guides — marketing, written from what we actually built";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogCard({
    eyebrow: "Guides",
    title: "Marketing, written from what we actually built.",
    sub: "No generated filler. Every guide is about something we did or measured.",
  });
}
