import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { allGuides, GUIDES, wordsIn } from "@/lib/guides";
import { url } from "@/lib/seo";

// The surfaces a search result, a share preview and a feed reader actually see.
//
// Each of these was wrong in production while every existing SEO test passed, because the
// tests checked the metadata a page declared and not what survived Next's merge.

const APP = join(process.cwd(), "app");

function filesNamed(dir: string, names: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesNamed(full, names));
    else if (names.includes(entry)) out.push(full);
  }
  return out;
}

describe("every page that names itself for sharing also has a picture", () => {
  // Next merges metadata shallowly. A page that sets `openGraph` replaces the parent's
  // object wholesale, so the root image vanishes from it. /guides, every guide and
  // /early-access unfurled as bare links on LinkedIn, WhatsApp and X — the pages most
  // likely to be shared — while /privacy, which set nothing, kept its image.
  //
  // A file-based opengraph-image in the same segment is attached after the page's own
  // metadata, so it survives. This walks the tree rather than listing pages, so a page
  // added next month is covered on the day it ships.
  const setters = filesNamed(APP, ["page.tsx", "layout.tsx"])
    .filter((f) => /\bopenGraph\s*:/.test(readFileSync(f, "utf8")));

  for (const file of setters) {
    const rel = file.slice(APP.length + 1);
    it(`${rel} has an opengraph-image beside it`, () => {
      const src = readFileSync(file, "utf8");
      // A page kept out of results is not shared from results; it may skip the image.
      if (/index:\s*false/.test(src)) return;
      expect(existsSync(join(dirname(file), "opengraph-image.tsx")), `${rel} sets openGraph with no image`).toBe(true);
    });
  }

  it("found the pages it is meant to guard", () => {
    // If the walk silently matched nothing, every assertion above would pass vacuously.
    expect(setters.length).toBeGreaterThanOrEqual(4);
  });
});

describe("reading time is measured, not typed", () => {
  it("matches the text for every guide", () => {
    for (const g of GUIDES) {
      expect(g.readingMinutes, g.slug).toBe(Math.max(1, Math.ceil(wordsIn(g.blocks) / 200)));
    }
  });

  it("is not hand-entered anywhere in the guide data", () => {
    // Every hand-typed value overstated its guide by about double. Structured data now
    // reads this, so an inflated number is a claim about the page, not a harmless label.
    const src = readFileSync(join(process.cwd(), "lib/guides.ts"), "utf8");
    expect(src).not.toMatch(/readingMinutes:\s*\d/);
  });
});

describe("the guides feed", () => {
  async function feed() {
    const { GET } = await import("@/app/guides/feed.xml/route");
    const res = GET();
    return { res, xml: await res.text() };
  }

  it("is served as RSS", async () => {
    const { res, xml } = await feed();
    expect(res.headers.get("Content-Type")).toMatch(/application\/rss\+xml/);
    expect(xml.startsWith("<?xml")).toBe(true);
    expect(xml).toContain('<rss version="2.0"');
  });

  it("lists every guide at its canonical url, once", async () => {
    const { xml } = await feed();
    for (const g of allGuides()) {
      const link = url(`/guides/${g.slug}`);
      expect(xml.split(`<link>${link}</link>`).length - 1, g.slug).toBe(1);
    }
  });

  it("escapes what XML cannot hold raw", async () => {
    // Guide copy uses ampersands and quotes freely. One raw `&` and every reader rejects
    // the whole feed, not just the item.
    const { xml } = await feed();
    const body = xml.replace(/<\?xml[^>]*\?>/, "");
    expect(body).not.toMatch(/&(?!amp;|lt;|gt;|quot;|#)/);
  });

  it("is advertised in <head> wherever a page restates alternates", () => {
    // `alternates` merges shallowly too, so a page setting its own canonical drops the
    // feed link the root layout declares unless it repeats it.
    for (const f of ["app/layout.tsx", "app/guides/page.tsx", "app/guides/[slug]/page.tsx"]) {
      expect(readFileSync(join(process.cwd(), f), "utf8"), f).toMatch(/"application\/rss\+xml":\s*"\/guides\/feed\.xml"/);
    }
  });
});

describe("structured data a validator will accept", () => {
  it("uses a raster logo at least 112px square", () => {
    // Google's logo guidance; an SVG is the format most often rejected in practice.
    const src = readFileSync(join(process.cwd(), "app/components/JsonLd.tsx"), "utf8");
    expect(src).toMatch(/logo:\s*\{[^}]*apple-icon\.png[^}]*width:\s*180/);
  });
});
