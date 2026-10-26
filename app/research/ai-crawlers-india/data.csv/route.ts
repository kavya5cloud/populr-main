import { studyCsv } from "@/lib/research/ai-crawlers-india";

// The study's dataset as CSV — free to use under CC BY 4.0.
export const dynamic = "force-static";

export function GET() {
  return new Response(studyCsv(), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'inline; filename="ai-crawlers-india.csv"' },
  });
}
