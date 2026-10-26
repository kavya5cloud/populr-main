import { ogCard, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og-card";
import { pct, studyStats } from "@/lib/research/ai-crawlers-india";

export const alt = "Do India's top websites let AI assistants in? — Populr research";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  const s = studyStats();
  return ogCard({
    eyebrow: "Research",
    title: "Do India's top websites let AI assistants in?",
    sub: `${pct(s.readable - s.blockAnyAnswers.length, s.readable)} of the top .in sites let AI search in. Amazon.in doesn't — and three government sites block every crawler.`,
  });
}
