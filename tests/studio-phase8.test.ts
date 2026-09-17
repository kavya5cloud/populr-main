import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONTENT_FORMATS, FORMAT_META, compose } from "@/lib/content/compose";
import { STUDIO_KINDS } from "@/lib/studio/kinds";
import { UNSUPPORTED_MEDIA_PATHS, STUDIO_FALLBACK, isUnsupportedMediaPath } from "@/lib/studio/unsupported";
import { STAGE_SEQUENCES, resolveRequestType } from "@/app/components/ai-processing/stages";

// Phase 8 — product truthfulness.
//
// The rule these tests exist to hold: a Studio surface may only offer what the backend
// actually produces. Populr writes words. It does not render images, motion or video, and
// nothing in the UI may imply otherwise.

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/** Source with comments removed. The assertions below are "this string must not appear",
 *  and the comments explaining *why* it must not appear would otherwise trip them. */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
}

describe("unsupported media surfaces are not exposed", () => {
  it("images and motion redirect to a surface that works", () => {
    for (const p of ["app/studio/images/page.tsx", "app/studio/motion/page.tsx"]) {
      const src = code(p);
      expect(src, p).toMatch(/redirect\(STUDIO_FALLBACK\)/);
      expect(src, p).toContain("next/navigation");
    }
    expect(STUDIO_FALLBACK).toBe("/studio/create");
  });

  it("the redirect target is a real route", () => {
    expect(() => read("app/studio/create/page.tsx")).not.toThrow();
  });

  it("neither page renders a generate control any more", () => {
    for (const p of ["app/studio/images/page.tsx", "app/studio/motion/page.tsx"]) {
      const src = code(p);
      expect(src, p).not.toContain("GenerateButton");
      expect(src, p).not.toContain("StudioSection");
    }
  });

  it("isUnsupportedMediaPath covers both routes and tolerates a trailing slash", () => {
    expect(isUnsupportedMediaPath("/studio/images")).toBe(true);
    expect(isUnsupportedMediaPath("/studio/motion/")).toBe(true);
    expect(isUnsupportedMediaPath("/studio/create")).toBe(false);
    expect(isUnsupportedMediaPath("/studio/videos")).toBe(false);
    // Not a prefix match: a future /studio/images-something is a different route.
    expect(isUnsupportedMediaPath("/studio/imagesx")).toBe(false);
    expect(UNSUPPORTED_MEDIA_PATHS).toEqual(["/studio/images", "/studio/motion"]);
  });

  it("navigation no longer highlights for a route that redirects away", () => {
    const nav = code("app/studio/StudioNav.tsx");
    const m = nav.match(/\/\^\\\/studio\\\/\(([^)]+)\)\$\//);
    expect(m, "Create match regex not found").toBeTruthy();
    const branches = m![1].split("|");
    expect(branches).not.toContain("images");
    expect(branches).not.toContain("motion");
    // The surfaces that do work stay in it.
    expect(branches).toContain("create");
    expect(branches).toContain("videos");
    expect(branches).toContain("ugc");
  });

  it("no Studio page passes images or motion to the Job Engine", () => {
    for (const p of ["app/studio/images/page.tsx", "app/studio/motion/page.tsx", "app/studio/videos/page.tsx"]) {
      expect(code(p), p).not.toContain("/api/jobs");
    }
  });
});

describe("video is a script, not a file", () => {
  it("the videos page leads with the Composer and no job", () => {
    const src = code("app/studio/videos/VideoScript.tsx");
    expect(src).toContain("Composer");
    expect(src).toContain('initialFormat="video_script"');
    expect(src).not.toContain("GenerateButton");
    expect(src).not.toContain("/api/jobs");
    expect(src).not.toContain("StudioSection");
  });

  it("the page says who holds the camera", () => {
    const src = read("app/studio/videos/VideoScript.tsx");
    expect(src).toMatch(/bring the camera/i);
    expect(src).toMatch(/does not film or render/i);
  });

  it("nothing on the video path mentions an mp4 or a render", () => {
    for (const p of ["app/studio/videos/VideoScript.tsx", "app/studio/videos/page.tsx", "lib/studio/kinds.ts"]) {
      const src = code(p);
      expect(src.toLowerCase(), p).not.toContain(".mp4");
      expect(src.toLowerCase(), p).not.toContain("mediauri");
      expect(src.toLowerCase(), p).not.toContain("populr://media");
    }
  });

  it("the progress stages describe writing, never rendering", () => {
    const titles = STAGE_SEQUENCES.video.map((s) => `${s.title} ${s.hint}`).join(" ").toLowerCase();
    expect(titles).not.toContain("render");
    expect(titles).not.toContain("frames to life");
    expect(titles).not.toContain("finalizing your video");
    expect(titles).toContain("script");
    expect(titles).toContain("shot list");
  });

  it("video_script is a real content format, not a special case", () => {
    expect(CONTENT_FORMATS as readonly string[]).toContain("video_script");
    expect(FORMAT_META.video_script.label).toMatch(/script/i);
    expect(FORMAT_META.video_script.blurb.toLowerCase()).toContain("film");
  });

  it("the Studio card uses that format", () => {
    const script = STUDIO_KINDS.find((k) => k.id === "script")!;
    expect(script.format).toBe("video_script");
    expect(script.seed).toMatch(/script and shot list/i);
  });

  it("the deterministic body is a shootable document, not a described video", async () => {
    const out = await compose({
      tenant: "t", prompt: "A 30-second script and shot list explaining what we do",
      format: "video_script", audience: "seed-stage founders", platforms: [], now: Date.parse("2026-08-30T00:00:00Z"),
    });
    const body = out.body;
    for (const section of ["Hook", "Shot 1", "On-screen text", "Voiceover", "Caption", "CTA"]) {
      expect(body, section).toContain(section);
    }
    expect(body.toLowerCase()).not.toContain(".mp4");
    expect(body.toLowerCase()).not.toContain("render");
  });
});

describe("the eight creation cards all remain backed by real generation", () => {
  it("every card maps to a real content format", () => {
    expect(STUDIO_KINDS).toHaveLength(8);
    for (const k of STUDIO_KINDS) {
      expect(CONTENT_FORMATS as readonly string[], k.id).toContain(k.format);
    }
  });

  it("no card names a media asset Populr cannot produce", () => {
    const words = ["image", "photo", "render", "clip", "voice", "audio", "footage", ".mp4"];
    for (const k of STUDIO_KINDS) {
      const text = `${k.title} ${k.blurb}`.toLowerCase();
      for (const w of words) expect(text, `${k.id} / ${w}`).not.toContain(w);
    }
  });

  it("every card composes through the real pipeline", async () => {
    for (const k of STUDIO_KINDS) {
      const out = await compose({
        tenant: "t", prompt: k.seed, format: k.format,
        audience: "seed-stage founders", platforms: [], now: Date.parse("2026-08-30T00:00:00Z"),
      });
      expect(out.body.length, k.id).toBeGreaterThan(40);
      expect(out.body, k.id).not.toContain("populr://");
    }
  });
});

describe("nothing else regressed", () => {
  it("UGC is untouched — it is a real text engine", () => {
    const ugc = read("app/studio/ugc/page.tsx");
    expect(ugc).toContain("UgcWorkspace");
    expect(ugc).not.toContain("redirect");
    // The engine it calls generates text through the shared LLM orchestration.
    expect(read("lib/ugc/ai.ts")).toContain("@/lib/services/llm");
  });

  it("the surfaces that work still render their section", () => {
    for (const p of ["app/studio/documents/page.tsx", "app/studio/ads/page.tsx", "app/studio/library/page.tsx"]) {
      expect(code(p), p).toContain("StudioSection");
    }
  });

  it("the content engine flag is unchanged", () => {
    const flags = code("lib/flags.ts");
    expect(flags).toContain("NEXT_PUBLIC_SHOW_CONTENT_ENGINE");
    // Phase 8 did not narrow the flag: the engine works, and these two routes should stay
    // gone at every flag value.
    expect(flags).not.toContain("UNSUPPORTED_MEDIA");
  });

  it("the existing formats are all still there", () => {
    for (const f of ["post", "thread", "blog", "email", "landing_page", "announcement", "carousel"]) {
      expect(CONTENT_FORMATS as readonly string[]).toContain(f);
    }
  });

  it("resolveRequestType still maps every studio feature to a sequence", () => {
    for (const f of ["video", "videos", "documents", "ads", "studio", "chat"]) {
      expect(STAGE_SEQUENCES[resolveRequestType(f)], f).toBeTruthy();
    }
  });
});

describe("no synthetic locator reaches a user", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => { warn.mockRestore(); });

  it("no Studio component references the media locator helper", () => {
    const files = [
      "app/studio/StudioSection.tsx", "app/studio/GenerateButton.tsx", "app/studio/Composer.tsx",
      "app/studio/create/Studio.tsx", "app/studio/create/CreationCard.tsx", "app/studio/videos/VideoScript.tsx",
    ];
    for (const f of files) {
      const src = code(f);
      expect(src, f).not.toContain("mediaUri");
      expect(src, f).not.toContain("populr://media");
    }
  });

  it("the dead media copy is gone from StudioSection", () => {
    const src = code("app/studio/StudioSection.tsx");
    expect(src).not.toContain("FIRST_STEP");
    expect(src.toLowerCase()).not.toContain("every image is generated");
    expect(src.toLowerCase()).not.toContain("storyboards it");
  });
});
