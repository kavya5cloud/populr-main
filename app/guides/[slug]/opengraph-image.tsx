import { guideBySlug } from "@/lib/guides";
import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og-card";

// Each guide shares with its own title, not the homepage's. A guide link pasted into a
// group chat is the most likely way anyone meets Populr for the first time; the card is
// what decides whether they open it.

export const alt = "A Populr guide";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = guideBySlug(slug);
  return ogCard({
    eyebrow: "Guide",
    title: guide?.title ?? "Populr guides",
    sub: guide ? `${guide.readingMinutes} min read` : undefined,
  });
}
