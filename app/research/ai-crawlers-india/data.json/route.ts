import { STUDY } from "@/lib/research/ai-crawlers-india";

// The study's dataset as JSON, exactly as collected — free to use under CC BY 4.0.
export const dynamic = "force-static";

export function GET() {
  return Response.json({ license: "https://creativecommons.org/licenses/by/4.0/", source: "https://www.trypopulr.in/research/ai-crawlers-india", ...STUDY });
}
