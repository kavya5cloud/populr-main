import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og-card";

export const alt = "Populr early access";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogCard({
    eyebrow: "Early access",
    title: "Your AI CMO decides what is worth doing — then does it.",
    sub: "Launch videos, UGC and motion creative are next. Get in early.",
  });
}
