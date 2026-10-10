import { NextResponse } from "next/server";
import { SITE_NAME, SITE_DESCRIPTION, SITE_URL, PUBLIC_ROUTES, url } from "@/lib/seo";
import { allGuides } from "@/lib/guides";

// Serves /llms.txt — the llms.txt convention for telling AI systems what this site is.
// Built the same way sitemap.ts and robots.ts are: derived from lib/seo.ts and
// lib/guides.ts, the same real routes and descriptions everything else on the site
// already agrees on. Nothing here is hand-typed. A short accurate file beats a long
// stale one — if a page's real title/description isn't available, it's left out rather
// than guessed.

export const dynamic = "force-static";

// Human-readable labels for the routes in PUBLIC_ROUTES. Kept beside the route list so
// the two are easy to compare, but intentionally not in lib/seo.ts — that file is
// consumed by the sitemap and robots, which don't need prose labels, and adding them
// there would be describing this file's needs in a shared file that has nothing to do
// with it.
const ROUTE_LABEL: Record<string, string> = {
  "/": "Home",
  "/early-access": "Early Access",
  "/developers": "Populr MCP server for developers",
  "/developers/docs": "MCP server documentation",
  "/guides": "Guides",
  "/privacy": "Privacy",
  "/terms": "Terms",
};

function buildLlmsTxt(): string {
  const lines: string[] = [`# ${SITE_NAME}`, "", `> ${SITE_DESCRIPTION}`, ""];

  const guides = allGuides();
  if (guides.length) {
    lines.push("## Guides");
    for (const g of guides) {
      lines.push(`- [${g.title}](${url(`/guides/${g.slug}`)}): ${g.description}`);
    }
    lines.push("");
  }

  const siteRoutes = PUBLIC_ROUTES.filter((r) => r.path !== "/guides" && ROUTE_LABEL[r.path]);
  if (siteRoutes.length) {
    lines.push("## Site");
    for (const r of siteRoutes) {
      const link = r.path === "/" ? SITE_URL : url(r.path);
      lines.push(`- [${ROUTE_LABEL[r.path]}](${link})`);
    }
  }

  return lines.join("\n") + "\n";
}

export async function GET() {
  return new NextResponse(buildLlmsTxt(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}