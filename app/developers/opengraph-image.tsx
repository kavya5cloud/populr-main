import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og-card";

export const alt = "Populr MCP server";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogCard({
    eyebrow: "For developers",
    title: "Ship your SEO from your code editor.",
    sub: "Claude Code · Cursor · VS Code · Windsurf",
  });
}
