import { describe, it, expect } from "vitest";
import { briefFromWorkspace, productIdentity, equivalent } from "@/lib/creative/studio-brief";
import { prepareCreative } from "@/lib/creative/brief";
import { buildRequest } from "@/lib/creative/providers/seedance";

// The request is an instruction, not copy.
//
// Studio used to send the user's sentence as both objective and keyMessage, so the script
// engine had no business facts and filled every gap with a readable placeholder. Four of six
// shots then carried filler, and Shot 1 carried the request sentence itself as on-screen
// text. These tests hold that closed.

const ASK = "Create a 10-second Instagram Reel announcing Populr as an AI CMO.";

// A profile for a business that is not Populr — the mapping must be general, so the fixture
// deliberately is not the product the smoke test uses.
const PROFILE = {
  name: "Harbour",
  oneLiner: "Freight paperwork that files itself",
  audience: "customs brokers",
  positioning: "the only filing tool built for Indian ports",
  voice: "plain, unhurried, specific",
  description: "Automates customs documentation for freight forwarders",
};

const prep = (over: Record<string, unknown> = {}) => prepareCreative({
  intelligence: { assetType: "hero_video", brief: briefFromWorkspace(ASK, PROFILE) },
  durationSec: 10, aspectRatio: "9:16", profile: PROFILE,
  ...over,
});

const bare = (over: Record<string, unknown> = {}) => prepareCreative({
  intelligence: { assetType: "hero_video", brief: briefFromWorkspace(ASK, null) },
  durationSec: 10, aspectRatio: "9:16", profile: null,
  ...over,
});

function promptOf(r: ReturnType<typeof prepareCreative>): string {
  if (!r.ok) throw new Error(`prepare failed: ${r.reason}`);
  return buildRequest(r.prepared.videoSpec).content[0].text;
}

describe("brief mapping", () => {
  it("keeps the request as the objective and never as the message", () => {
    const b = briefFromWorkspace(ASK, PROFILE);
    expect(b.objective).toBe(ASK);
    expect(b.keyMessage).toBe(PROFILE.oneLiner);
    expect(b.keyMessage).not.toBe(ASK);
  });

  it("reads audience and voice from the workspace", () => {
    const b = briefFromWorkspace(ASK, PROFILE);
    expect(b.audience).toBe("customs brokers");
    expect(b.emotionalAngle).toBe("plain, unhurried, specific");
  });

  it("falls back to positioning when there is no one-liner", () => {
    const b = briefFromWorkspace(ASK, { ...PROFILE, oneLiner: "" });
    expect(b.keyMessage).toBe(PROFILE.positioning);
  });

  it("leaves fields the workspace has no source for empty rather than guessing", () => {
    const b = briefFromWorkspace(ASK, PROFILE);
    expect(b.proof).toBe("");
    expect(b.cta).toBe("");
    expect(b.visualDirection).toBe("");
    expect(b.successMetric).toBe("");
  });

  it("produces an entirely empty brief for a workspace with no profile", () => {
    const b = briefFromWorkspace(ASK, null);
    expect(b.audience).toBe("");
    expect(b.keyMessage).toBe("");
    expect(b.objective).toBe(ASK);
  });

  it("reads product identity from context, never a hardcoded product", async () => {
    expect(productIdentity(PROFILE)).toEqual({ name: "Harbour", summary: PROFILE.oneLiner });
    expect(productIdentity(null)).toBeNull();
    expect(productIdentity({ name: "" })).toBeNull();

    const { readFileSync } = await import("node:fs");
    for (const f of ["lib/creative/studio-brief.ts", "lib/creative/video-prompt.ts"]) {
      const code = readFileSync(f, "utf8")
        .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
      expect(code, f).not.toContain("Populr");
      expect(code, f).not.toContain("AI CMO");
    }
  });
});

describe("the request never becomes on-screen text", () => {
  it("no shot caption is the request or a truncation of it", () => {
    for (const r of [prep(), bare()]) {
      if (!r.ok) throw new Error("prepare failed");
      for (const shot of r.prepared.storyboard) {
        if (!shot.onScreenText) continue;
        expect(equivalent(shot.onScreenText, ASK), shot.onScreenText).toBe(false);
        expect(shot.onScreenText).not.toContain("Instagram Reel");
      }
    }
  });

  it("the request does not appear as a quoted on-screen instruction in the prompt", () => {
    expect(promptOf(prep())).not.toContain(`On-screen text: "${ASK}"`);
    expect(promptOf(bare())).not.toContain(`On-screen text: "${ASK}"`);
  });
});

describe("placeholders are suppressed when the brief cannot support them", () => {
  it("does not emit 'how it works' when there is no proof", () => {
    for (const r of [prep(), bare()]) {
      const prompt = promptOf(r);
      expect(prompt).not.toContain("how it works");
    }
  });

  it("does not emit 'get started' when there is no CTA", () => {
    for (const r of [prep(), bare()]) {
      const prompt = promptOf(r);
      expect(prompt).not.toContain("get started");
      expect(prompt).toContain("Do not invent a call to action");
    }
  });

  it("does not claim an audience nobody named", () => {
    const prompt = promptOf(bare());
    expect(prompt).not.toContain("for founders");
    expect(prompt).not.toContain("For your audience");
    expect(prompt).not.toContain("the core promise");
  });

  it("states the real audience when the workspace has one", () => {
    expect(promptOf(prep())).toContain("for customs brokers");
  });

  it("prefers an empty shot to filler", () => {
    const r = bare();
    if (!r.ok) throw new Error("prepare failed");
    // With no business facts at all, no shot can carry supported copy.
    expect(r.prepared.storyboard.every((s) => s.onScreenText === null)).toBe(true);
  });

  it("emits copy that IS supported by the brief", () => {
    const withCta = prepareCreative({
      intelligence: { assetType: "hero_video", brief: {
        ...briefFromWorkspace(ASK, PROFILE), proof: "4,000 filings a month", cta: "Book a walkthrough",
      } },
      durationSec: 10, aspectRatio: "9:16", profile: PROFILE,
    });
    const prompt = promptOf(withCta);
    expect(prompt).toContain("4,000 filings a month");
    expect(prompt).toContain("End on: Book a walkthrough.");
  });

  it("puts the business's own promise in the prompt, once", () => {
    const prompt = promptOf(prep());
    expect(prompt).toContain("Harbour");
    expect(prompt).toContain(PROFILE.oneLiner);
    // The subject line already carries it, so the separate "The promise:" line is dropped.
    // It may still appear a second time as a shot's on-screen text — that is the caption
    // being drawn on screen, which is the point, not a duplicated instruction.
    expect(prompt).not.toContain("The promise:");
    const briefingHalf = prompt.split("Shots:")[0];
    expect(briefingHalf.split(PROFILE.oneLiner).length - 1).toBe(1);
  });

  it("keeps multi-word brand-voice phrases intact", () => {
    // "no hype" was being split on the space into "no, hype".
    const r = prepareCreative({
      intelligence: { assetType: "hero_video", brief: briefFromWorkspace(ASK, { ...PROFILE, voice: "calm, specific, no hype" }) },
      durationSec: 10, aspectRatio: "9:16", profile: PROFILE,
    });
    const tone = promptOf(r).split("\n").find((l) => l.startsWith("Tone:")) ?? "";
    expect(tone).toContain("no hype");
    expect(tone).not.toContain("no, hype");
  });
});

describe("equivalence detection", () => {
  it("matches across case, punctuation and truncation", () => {
    expect(equivalent(ASK, ASK.toUpperCase())).toBe(true);
    expect(equivalent(ASK, `${ASK.slice(0, 40)}…`)).toBe(true);
    expect(equivalent("Freight paperwork that files itself", "freight paperwork that files itself.")).toBe(true);
  });

  it("does not match genuinely different copy, or trivially short strings", () => {
    expect(equivalent(ASK, "Freight paperwork that files itself")).toBe(false);
    expect(equivalent("", ASK)).toBe(false);
    expect(equivalent("go", "going somewhere else entirely")).toBe(false);
  });
});

describe("nothing from earlier phases regressed", () => {
  it("shot durations still sum to exactly ten seconds", () => {
    for (const r of [prep(), bare()]) {
      if (!r.ok) throw new Error("prepare failed");
      expect(r.prepared.storyboard.reduce((n, s) => n + s.durationSec, 0)).toBe(10);
      expect(r.prepared.storyboard.every((s) => s.durationSec >= 1)).toBe(true);
    }
  });

  it("the envelope is unchanged", () => {
    const r = prep();
    if (!r.ok) throw new Error("prepare failed");
    const body = buildRequest(r.prepared.videoSpec);
    expect(body.ratio).toBe("9:16");
    expect(body.resolution).toBe("720p");
    expect(body.duration).toBe(10);
    expect(body.generate_audio).toBe(false);
    expect(body.model).toBe("dreamina-seedance-2-0-mini-260615");
    expect(body.output_format).toBe("mp4");
  });

  it("Hindi still reaches the renderer as an on-screen-text instruction", () => {
    const r = prep({ language: "hi-IN" });
    if (!r.ok) throw new Error("prepare failed");
    const prompt = promptOf(r);
    expect(r.prepared.language).toBe("hi-IN");
    expect(prompt).toContain("Hindi");
    expect(prompt).toContain("हिन्दी");
    expect(prompt).toContain("Do not use English text on screen");
  });

  it("English is still stated explicitly", () => {
    expect(promptOf(prep())).toContain("on-screen text is in English");
  });

  it("still refuses to invent a brand it has never seen", () => {
    const prompt = promptOf(prep());
    expect(prompt).toContain("no logo or brand mark");
    expect(prompt).toContain("no readable product interface");
    expect(prompt).toContain("no identifiable individuals");
    expect(prompt).toContain("no statistics, numbers, charts or claims");
  });

  it("preview and generate prepare the identical specification", () => {
    // Both routes call prepareCreative with the same arguments; identical input must give a
    // byte-identical prompt and storyboard, or the screen and the invoice disagree.
    const a = prep();
    const b = prep();
    if (!a.ok || !b.ok) throw new Error("prepare failed");
    expect(a.prepared.videoSpec.prompt).toBe(b.prepared.videoSpec.prompt);
    expect(a.prepared.storyboard).toEqual(b.prepared.storyboard);
    expect(a.prepared.specHash).toBe(b.prepared.specHash);
  });

  it("a different business produces a different creative", () => {
    const other = prepareCreative({
      intelligence: { assetType: "hero_video", brief: briefFromWorkspace(ASK, { ...PROFILE, name: "Other", oneLiner: "Something else entirely" }) },
      durationSec: 10, aspectRatio: "9:16",
      profile: { ...PROFILE, name: "Other", oneLiner: "Something else entirely" },
    });
    expect(promptOf(other)).not.toBe(promptOf(prep()));
    expect(promptOf(other)).toContain("Other");
  });
});

describe("preview makes no provider call", () => {
  it("preparing a creative performs no network request", () => {
    const real = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => { calls++; throw new Error("network"); }) as never;
    try {
      const r = prep();
      expect(r.ok).toBe(true);
      if (r.ok) buildRequest(r.prepared.videoSpec);
      expect(calls).toBe(0);
    } finally { globalThis.fetch = real; }
  });
});

describe("visual direction is derived from context, not templated filler", () => {
  const promptFor = (profile: Record<string, string> | null) => {
    const r = prepareCreative({
      intelligence: { assetType: "hero_video", brief: briefFromWorkspace(ASK, profile) },
      durationSec: 10, aspectRatio: "9:16", profile,
    });
    if (!r.ok) throw new Error(`prepare failed: ${r.reason}`);
    return r.prepared;
  };

  it("names the audience and the subject inside the shots themselves", () => {
    const p = promptFor(PROFILE);
    const shots = p.storyboard.map((s) => s.description).join("\n");
    expect(shots).toContain("customs brokers");
    expect(shots).toContain("Harbour");
    // The generic beat descriptions are gone from a workspace that has context.
    expect(shots).not.toContain("Show the pain in a relatable moment");
    expect(shots).not.toContain("Reveal the product hero shot");
  });

  it("two different businesses get genuinely different visual direction", () => {
    const a = promptFor(PROFILE);
    const b = promptFor({
      name: "Fernwood", oneLiner: "Care homes that families can see into",
      audience: "care home managers", positioning: "transparency for families", voice: "warm, plain",
    });
    const aShots = a.storyboard.map((s) => s.description);
    const bShots = b.storyboard.map((s) => s.description);
    expect(aShots).not.toEqual(bShots);
    expect(bShots.join(" ")).toContain("care home managers");
    expect(bShots.join(" ")).not.toContain("customs brokers");
  });

  it("keeps the structural description when the workspace has no context to add", () => {
    // Vaguer is the honest cost of an unanalysed workspace — better than a specific
    // description of a business we cannot describe.
    const p = promptFor(null);
    expect(p.storyboard[0].description).toBe("Establish the world before the product");
  });

  it("introduces no unsupported claim, logo, interface or person", () => {
    const p = promptFor(PROFILE);
    const prompt = buildRequest(p.videoSpec).content[0].text;
    const shots = p.storyboard.map((s) => s.description).join(" ").toLowerCase();

    // The product is represented abstractly — never as a screenshot or a mark.
    expect(shots).toContain("abstractly");
    expect(shots).not.toMatch(/\blogo\b(?!.*no )/);
    expect(shots).not.toContain("screenshot");
    expect(shots).not.toContain("dashboard");
    // No fabricated evidence of any kind.
    for (const invented of ["testimonial", "customer says", "% ", "5-star", "award", "trusted by"]) {
      expect(shots, invented).not.toContain(invented);
    }
    // And the constraints spell all of it out to the renderer.
    expect(prompt).toContain("no logo or brand mark of any kind");
    expect(prompt).toContain("no readable product interface");
    expect(prompt).toContain("no identifiable individuals, spokespeople or testimonials");
    expect(prompt).toContain("no statistics, numbers, charts or claims");
  });

  it("carries no business-specific wording in the engine itself", async () => {
    const { readFileSync } = await import("node:fs");
    const code = readFileSync("lib/creative/video-prompt.ts", "utf8")
      .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    for (const specific of ["Populr", "AI CMO", "agency retainer", "Harbour", "customs"]) {
      expect(code, specific).not.toContain(specific);
    }
  });

  it("still totals exactly ten seconds with the richer descriptions", () => {
    for (const profile of [PROFILE, null]) {
      const p = promptFor(profile);
      expect(p.storyboard.reduce((n, s) => n + s.durationSec, 0)).toBe(10);
      expect(p.storyboard).toHaveLength(6);
      expect(p.storyboard.every((s) => s.durationSec >= 1)).toBe(true);
    }
  });

  it("the Studio storyboard and the provider prompt still agree shot for shot", () => {
    const p = promptFor(PROFILE);
    const prompt = buildRequest(p.videoSpec).content[0].text;
    for (const shot of p.storyboard) expect(prompt, `shot ${shot.n}`).toContain(shot.description);
  });
});

describe("copy never leaks into visual descriptions", () => {
  const board = () => {
    const r = prep();
    if (!r.ok) throw new Error("prepare failed");
    return r.prepared;
  };

  it("no shot description repeats the marketing promise", () => {
    // A model reading "Show the change taking effect — <promise> —" has every reason to
    // render those words on screen. Copy belongs in on-screen text, chosen explicitly.
    for (const shot of board().storyboard) {
      expect(shot.description, `shot ${shot.n}`).not.toContain(PROFILE.oneLiner);
      expect(shot.description, `shot ${shot.n}`).not.toContain(PROFILE.positioning);
    }
  });

  it("no shot description repeats the raw request", () => {
    for (const shot of board().storyboard) {
      expect(equivalent(shot.description, ASK), `shot ${shot.n}`).toBe(false);
      expect(shot.description).not.toContain("Instagram Reel");
    }
  });

  it("the capability shot describes a transformation, with no copy and no caption", () => {
    const p = board();
    const shot4 = p.storyboard[3];
    expect(shot4.description).toContain("customs brokers");
    expect(shot4.description).toContain("Abstract representation only");
    expect(shot4.description).not.toContain(PROFILE.oneLiner);
    // Shot 4 carries no on-screen text — the brief supports none for that beat.
    expect(shot4.onScreenText).toBeNull();
  });

  it("Shot 1 keeps its legitimate on-screen text", () => {
    const shot1 = board().storyboard[0];
    expect(shot1.onScreenText).toBe(PROFILE.oneLiner);
  });

  it("the promise appears only where it was explicitly selected as on-screen text", () => {
    const p = board();
    const prompt = buildRequest(p.videoSpec).content[0].text;
    const occurrences = prompt.split(PROFILE.oneLiner).length - 1;
    // Once in the Subject line, once as Shot 1's quoted on-screen text. Nowhere else.
    expect(occurrences).toBe(2);
    expect(prompt).toContain(`On-screen text: "${PROFILE.oneLiner}"`);
  });

  it("still six shots totalling exactly ten seconds", () => {
    const p = board();
    expect(p.storyboard).toHaveLength(6);
    expect(p.storyboard.reduce((n, s) => n + s.durationSec, 0)).toBe(10);
  });
});
