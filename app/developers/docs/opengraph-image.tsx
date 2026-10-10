import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og-card";

export const alt = "Populr MCP server";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogCard({
    eyebrow: "Docs",
    title: "Populr MCP server: setup, tools and workflow.",
    sub: "Claude Code · Cursor · VS Code · Windsurf",
  });
}
