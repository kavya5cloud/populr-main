import { describe, it, expect } from "vitest";
import { prepareCreative } from "@/lib/creative/brief";
import { buildVideoPrompt, storyboardOf, fitScenes } from "@/lib/creative/video-prompt";
import { buildRequest } from "@/lib/creative/providers/seedance";
import { buildSpecification, buildScript } from "@/lib/creative-intelligence";
import type { Scene } from "@/lib/creative-intelligence";

// Phase 10C — Populr creates the creative, the provider renders it.
//
// The claims under test are about responsibility, not formatting: the raw request sentence
// must not be what a renderer is asked to interpret, and the storyboard on screen must be
// the storyboard in the prompt.

const ASK = "Create a 10-second Instagram Reel announcing Populr as an AI CMO";

const BRIEF = {
  objective: ASK,
  audience: "seed-stage founders",
  keyMessage: "Populr replaces the agency retainer",
  emotionalAngle: "calm confidence",
  proof: "nine agents running daily",
  cta: "start free",
  visualDirection: "clean, premium",
  successMetric: "signups",
};

const req = (over: Record<string, unknown> = {}) => prepareCreative({
  intelligence: { assetType: "hero_video", brief: BRIEF },
  durationSec: 10,
  ...over,
});

function ok() {
  const r = req();
  if (!r.ok) throw new Error(`prepare failed: ${r.reason}`);
  return r.prepared;
}

describe("the raw request becomes a specification, not a provider instruction", () => {
  it("a user sentence produces a full GenerationSpecification", () => {
    const spec = ok().spec;
    expect(spec.storyStructure).not.toBeNull();
    expect(spec.storyStructure!.acts.length).toBeGreaterThan(1);
    expect(spec.visualDirection.colorPalette.length).toBeGreaterThan(0);
    expect(spec.audience).toBeTruthy();
  });

  it("the provider is NOT handed the raw request sentence as its instruction", () => {
    const prompt = buildRequest(ok().videoSpec).content[0].text;
    // The words may survive inside a logline the story built; what must not happen is the
    // prompt *being* the ask, leaving the renderer to work out the marketing.
    expect(prompt).not.toBe(ASK);
    expect(prompt.length).toBeGreaterThan(ASK.length * 3);
    expect(prompt).toContain("Shots:");
  });

  it("no internal identifiers reach the provider", () => {
    const prompt = buildRequest(ok().videoSpec).content[0].text;
    for (const leak of ["workspaceKey", "user:", "anon:", "specId", "campaignId", "missionId", "spec_", "scene_"]) {
      expect(prompt, leak).not.toContain(leak);
    }
  });

  it("copywriting rules are withheld from a renderer", () => {
    const prompt = buildRequest(ok().videoSpec).content[0].text;
    // The previous prompt shipped "Brand voice: ... Never: #1, guaranteed, best in the
    // world". A video model cannot honour a claims policy, and listing forbidden
    // superlatives to an image generator invites it to draw them.
    expect(prompt).not.toContain("Brand voice");
    expect(prompt).not.toContain("Never:");
    expect(prompt).not.toContain("guaranteed");
  });

  it("the hook never reaches the renderer, as a template or rendered", () => {
    const prompt = buildRequest(ok().videoSpec).content[0].text;
    for (const placeholder of ["{product}", "{audience}", "{pain}", "{metric}"]) {
      expect(prompt, placeholder).not.toContain(placeholder);
    }
    // Rendering it substituted {product} with the raw request sentence, producing
    // "The Create a 10-second Instagram Reel ... trick founders aren't talking about yet".
    expect(prompt).not.toContain("aren't talking about");
    expect(prompt).not.toContain("Opening idea");
  });

  it("no on-screen text is the raw request sentence", () => {
    const p = ok();
    for (const shot of p.storyboard) {
      if (shot.onScreenText) {
        expect(shot.onScreenText).not.toContain("Instagram Reel");
        expect(shot.onScreenText).not.toContain("AI CMO trick");
      }
    }
  });

  it("does not say the same thing twice", () => {
    const prompt = buildRequest(ok().videoSpec).content[0].text;
    // "Tone: calm confidence, confidence. Mood: calm confidence · confidence."
    expect(prompt).not.toMatch(/Tone: ([a-z ]+), \1/);
    expect(prompt).not.toContain("Mood:");
    // "Camera: slow push. slow push camera; ..."
    expect(prompt).not.toMatch(/Camera: ([a-z ]+)\. \1 camera/);
  });
});

describe("shots reach the provider", () => {
  it("every storyboard shot appears in the prompt with its timing and camera", () => {
    const p = ok();
    const prompt = buildRequest(p.videoSpec).content[0].text;
    expect(p.storyboard.length).toBeGreaterThan(1);
    for (const shot of p.storyboard) {
      expect(prompt, `shot ${shot.n}`).toContain(`Shot ${shot.n}`);
      expect(prompt, `shot ${shot.n} desc`).toContain(shot.description);
      expect(prompt, `shot ${shot.n} camera`).toContain(shot.camera);
    }
  });

  it("preserves the existing Shot fields rather than inventing new ones", () => {
    const scenes = ok().spec.storyStructure!.acts.flatMap((a) => a.scenes);
    const board = ok().storyboard;
    // Timing and camera still come straight off the Scene the story engine built — the
    // visual description is now written from the brief, but the structure underneath it is
    // still the engine's and is not re-ordered, re-timed or added to.
    expect(board).toHaveLength(scenes.length);
    expect(board.map((b) => b.camera)).toEqual(scenes.map((s) => s.camera.replace(/_/g, " ")));
    expect(board.every((b) => b.description.length > 0)).toBe(true);
  });

  it("shot durations always sum to exactly the requested duration", () => {
    for (const durationSec of [4, 7, 10, 15]) {
      const r = req({ durationSec });
      expect(r.ok, String(durationSec)).toBe(true);
      if (r.ok) {
        const total = r.prepared.storyboard.reduce((n, s) => n + s.durationSec, 0);
        expect(total, `${durationSec}s`).toBe(durationSec);
        expect(r.prepared.storyboard.every((s) => s.durationSec >= 1)).toBe(true);
      }
    }
  });

  it("fits a 30-second story into a 10-second render without sub-second shots", () => {
    // The real mismatch this solves: launch_video is a 30s six-beat story.
    const story = buildSpecification({ assetType: "hero_video", brief: BRIEF }).storyStructure!;
    expect(story.totalDurationSec).toBeGreaterThan(10);

    const scenes = story.acts.flatMap((a) => a.scenes);
    const fitted = fitScenes(scenes, 10);
    expect(fitted.reduce((n, f) => n + f.sec, 0)).toBe(10);
    expect(fitted.every((f) => f.sec >= 1)).toBe(true);
  });

  it("drops beats rather than emitting shots shorter than a second", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `s${i}`, visualObjective: `beat ${i}`, camera: "static", durationSec: 5,
      purpose: "", emotion: "confidence", transition: "cut", shots: [], visualNotes: "", motionNotes: "",
    })) as unknown as Scene[];
    const fitted = fitScenes(many, 4);
    expect(fitted.reduce((n, f) => n + f.sec, 0)).toBe(4);
    expect(fitted.every((f) => f.sec >= 1)).toBe(true);
    // The arc is kept: first beat and last beat survive the cut.
    expect(fitted[0].scene.id).toBe("s0");
    expect(fitted[fitted.length - 1].scene.id).toBe("s11");
  });
});

describe("the envelope is preserved", () => {
  it("duration and aspect ratio survive into the provider request", () => {
    const r = req({ durationSec: 12, aspectRatio: "16:9" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const body = buildRequest(r.prepared.videoSpec);
    expect(body.duration).toBe(12);
    expect(body.ratio).toBe("16:9");
    expect(body.content[0].text).toContain("12-second");
    expect(body.content[0].text).toContain("16:9");
  });
});

describe("language", () => {
  it("English is stated and no second language list is introduced", () => {
    const prompt = buildRequest(ok().videoSpec).content[0].text;
    expect(prompt).toContain("on-screen text is in English");
  });

  it("Hindi reaches the renderer as an on-screen-text instruction", () => {
    const r = req({ language: "hi-IN" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const prompt = buildRequest(r.prepared.videoSpec).content[0].text;
    expect(r.prepared.language).toBe("hi-IN");
    expect(prompt).toContain("Hindi");
    expect(prompt).toContain("हिन्दी");
    expect(prompt.toLowerCase()).toContain("devanagari");
    expect(prompt).toContain("Do not use English text on screen");
  });

  it("the vendor is never named in the prompt", () => {
    const r = req({ language: "ta-IN" });
    if (!r.ok) return;
    const prompt = buildRequest(r.prepared.videoSpec).content[0].text.toLowerCase();
    for (const vendor of ["sarvam", "seedance", "dreamina", "byteplus", "groq", "gemini"]) {
      expect(prompt, vendor).not.toContain(vendor);
    }
  });

  it("an unrecognised language falls back rather than being passed through", () => {
    const r = req({ language: "xx-YY" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.prepared.language).toBe("en-IN");
  });

  it("language changes the identity of a generation", () => {
    const en = req({ language: "en-IN" });
    const hi = req({ language: "hi-IN" });
    if (en.ok && hi.ok) expect(en.prepared.specHash).not.toBe(hi.prepared.specHash);
  });
});

describe("one source of truth", () => {
  it("the Studio storyboard and the provider prompt come from the same specification", () => {
    const p = ok();
    // Every input, including the brief — the caption filter reads it to decide which
    // on-screen text the brief can actually support, so omitting it here would be comparing
    // two different requests and calling the difference a drift.
    const rebuilt = storyboardOf({
      spec: p.spec, durationSec: p.durationSec, aspectRatio: p.aspectRatio,
      languageCode: p.language, script: p.script, brief: BRIEF,
    });
    expect(rebuilt).toEqual(p.storyboard);
  });

  it("preparing the same request twice is byte-identical", () => {
    const a = ok();
    const b = ok();
    expect(a.videoSpec.prompt).toBe(b.videoSpec.prompt);
    expect(a.storyboard).toEqual(b.storyboard);
    expect(a.specHash).toBe(b.specHash);
  });

  it("the script is the intelligence layer's, not a second one", () => {
    const p = ok();
    const direct = buildScript(BRIEF, "hero_video", { story: p.spec.storyStructure!, hook: p.spec.hook });
    expect(p.script.id).toBe(direct.id);
    expect(p.script.sections.map((s) => s.text)).toEqual(direct.sections.map((s) => s.text));
  });
});

describe("no provider logic leaked into creative-intelligence", () => {
  it("the intelligence layer names no vendor and no provider constraint", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    for (const f of readdirSync("lib/creative-intelligence")) {
      if (!f.endsWith(".ts")) continue;
      const src = readFileSync(`lib/creative-intelligence/${f}`, "utf8").toLowerCase();
      for (const leak of ["seedance", "dreamina", "byteplus", "ark_api_key", "video_url", "callback_url"]) {
        expect(src, `${f} / ${leak}`).not.toContain(leak);
      }
    }
  });

  it("the prompt builder is the only place provider phrasing lives", async () => {
    const { readFileSync } = await import("node:fs");
    // video-prompt.ts imports from creative-intelligence, never the other way round.
    expect(readFileSync("lib/creative/video-prompt.ts", "utf8")).toContain("@/lib/creative-intelligence");
    expect(readFileSync("lib/creative-intelligence/contract.ts", "utf8")).not.toContain("@/lib/creative/video-prompt");
  });
});

describe("quality gates before spending", () => {
  it("refuses an invalid envelope before any provider call", () => {
    expect(req({ durationSec: 2 })).toMatchObject({ ok: false });
    expect(req({ durationSec: 99 })).toMatchObject({ ok: false });
    expect(req({ aspectRatio: "7:3" })).toMatchObject({ ok: false, reason: "unsupported_aspect_ratio" });
    expect(req({ resolution: "4k" })).toMatchObject({ ok: false, reason: "unsupported_resolution" });
  });

  it("produces a prompt within the provider-facing length ceiling", () => {
    expect(ok().videoSpec.prompt.length).toBeLessThanOrEqual(4000);
    expect(ok().videoSpec.prompt.length).toBeGreaterThan(200);
  });

  it("never truncates away a shot or the constraints", () => {
    const p = ok();
    const prompt = p.videoSpec.prompt;
    // Every shot survives, including the last.
    for (const shot of p.storyboard) expect(prompt, `shot ${shot.n}`).toContain(`Shot ${shot.n} —`);
    // And the constraint block is always the ending, whatever the body length.
    expect(prompt.trimEnd().endsWith("no text other than the on-screen text specified above.")).toBe(true);
  });

  it("tells the renderer not to invent a brand it has never seen", () => {
    // Populr holds no logo or product image, so a fabricated brand mark on screen would be
    // an invented identity. References remain a future phase.
    const prompt = ok().videoSpec.prompt;
    expect(prompt).toContain("no logo or brand mark");
    expect(prompt).toContain("no readable product interface");
  });
});

describe("the existing text path is unchanged", () => {
  it("toProviderSpec still renders its own instruction for non-video callers", async () => {
    const { toProviderSpec } = await import("@/lib/creative-intelligence");
    const spec = buildSpecification({ assetType: "blog", brief: BRIEF });
    const out = toProviderSpec(spec);
    expect(out.prompt.length).toBeGreaterThan(0);
    expect(out.modality).not.toBe("video");
  });
});

// Part 14/15: print the real request for manual review. No provider is called.
describe("manual pre-generation inspection", () => {
  it("prints the provider prompt that would be sent", () => {
    const body = buildRequest(ok().videoSpec);
    const out = [
      "",
      "================ PROVIDER REQUEST (not sent) ================",
      `model: ${body.model}  ratio: ${body.ratio}  resolution: ${body.resolution}  duration: ${body.duration}s`,
      "-------------------------- prompt ---------------------------",
      body.content[0].text,
      "=============================================================",
      "",
    ].join("\n");
    process.stdout.write(out);
    expect(body.content[0].text).toContain("Shot 1");
  });
});
