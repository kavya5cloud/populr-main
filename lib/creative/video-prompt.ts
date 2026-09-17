import type { GenerationSpecification, Scene, SceneEmotion, Script } from "@/lib/creative-intelligence";
import type { CreativeBriefInput } from "@/lib/creative/types";
import { equivalent, productIdentity, type WorkspaceProfile } from "./studio-brief";
import { DEFAULT_LANGUAGE, isEnglish, language, type LanguageCode } from "@/lib/i18n/languages";

// GenerationSpecification → the text a video model is given.
//
// Serialization, not intelligence. Every decision in the output was made upstream by
// lib/creative-intelligence: the beats, their order, their durations, the camera moves, the
// emotion, the palette. This file chooses what a *renderer* needs to see and what it does
// not, and writes it down in the order a shot list is normally read.
//
// The distinction that matters: Populr decides what the video is; the provider decides how
// to draw it. So the prompt describes shots, and never asks the model to work out a
// marketing strategy from a sentence like "announce our product".
//
// What is deliberately withheld, having looked at what the old prompt actually sent:
//
//   - Brand voice and banned claims ("Never: #1, guaranteed, best in the world"). Those are
//     copywriting rules. A video model cannot honour them and listing forbidden superlatives
//     to an image generator invites it to draw the words.
//   - The internal asset-kind slug ("hero video for founders" opened the old prompt).
//   - Spec ids, campaign ids, mission ids, workspace keys — none of a renderer's business.
//   - The raw user sentence as an instruction. It informs the story upstream; by the time we
//     are talking to a renderer it has already been turned into shots.

export type VideoPromptInput = {
  spec: GenerationSpecification;
  durationSec: number;
  aspectRatio: string;
  languageCode?: LanguageCode;
  /** The script, when the intelligence layer produced one. Used for on-screen text only. */
  script?: Script | null;
  /**
   * The brief the specification came from. Read only to decide what on-screen text is
   * *supported* — a caption the brief cannot back is dropped rather than shown.
   */
  brief?: CreativeBriefInput | null;
  /** The business, when the workspace knows it. Never a hardcoded product. */
  profile?: WorkspaceProfile | null;
};

/**
 * Our own ceiling, not the provider's — BytePlus publishes no prompt length limit, and the
 * documented example requests are themselves long. It exists so a pathological
 * specification cannot produce an unbounded request, and it is set well above a full
 * six-shot list so ordinary work is never trimmed: the previous 2000 silently dropped the
 * last shot once the visual direction became specific, which is a worse failure than a long
 * prompt.
 */
const MAX_PROMPT_CHARS = 4000;

/**
 * Fit the story's scenes into the duration actually being bought.
 *
 * This exists because of a real mismatch: the launch_video format is a 30-second story with
 * six beats, and the MVP renders 10 seconds. Something has to give, and the honest options
 * were to scale or to drop beats. Scaling proportionally keeps the whole arc — setup,
 * problem, product, proof, outcome, CTA — which is the part that makes it a launch video
 * rather than four seconds of stock footage.
 *
 * Every scene is guaranteed at least one second, and the rounding remainder is given to the
 * longest scene so the shot durations always sum to exactly the requested total. A shot list
 * whose numbers do not add up is the kind of detail a model notices and a reader trusts.
 */
export function fitScenes(scenes: Scene[], totalSec: number): { scene: Scene; sec: number }[] {
  if (!scenes.length) return [];
  // More scenes than seconds: keep the ones that carry the arc — first, last, and the
  // earliest middles — rather than emitting sub-second shots nothing can render.
  const usable = scenes.length <= totalSec
    ? scenes
    : [scenes[0], ...scenes.slice(1, -1).slice(0, Math.max(0, totalSec - 2)), scenes[scenes.length - 1]];

  const storyTotal = usable.reduce((n, s) => n + s.durationSec, 0) || usable.length;
  const scaled = usable.map((scene) => ({
    scene,
    sec: Math.max(1, Math.round((scene.durationSec / storyTotal) * totalSec)),
  }));

  // Reconcile rounding against the requested total.
  let drift = scaled.reduce((n, s) => n + s.sec, 0) - totalSec;
  while (drift !== 0) {
    const idx = drift > 0
      ? scaled.reduce((best, s, i) => (s.sec > scaled[best].sec ? i : best), 0)
      : scaled.reduce((best, s, i) => (s.sec < scaled[best].sec ? i : best), 0);
    if (drift > 0 && scaled[idx].sec <= 1) break;   // cannot shrink below a second
    scaled[idx].sec += drift > 0 ? -1 : 1;
    drift += drift > 0 ? -1 : 1;
  }
  return scaled;
}

// ---------------------------------------------------------------------------
// Visual direction
// ---------------------------------------------------------------------------

/**
 * What is actually in frame, per shot.
 *
 * The story engine's beat descriptions are structural — "Establish the world before the
 * product", "Show the pain in a relatable moment". They are the right *narrative* answer and
 * a useless *visual* one: a renderer given them draws six unrelated stock shots.
 *
 * So each beat's emotional role is paired with the two facts a workspace actually has: who
 * the audience is, and what the business says it does. Nothing else is used, because nothing
 * else is known. There is no environment inferred from positioning, no industry guessed from
 * a name, no persona invented to stand in front of the camera.
 *
 * The templates are keyed on the emotion the story engine already assigned, so this reads
 * the specification rather than second-guessing it. With no profile the shot keeps its
 * structural description unchanged — a vaguer prompt is the honest cost of an unanalysed
 * workspace, and better than a specific one about a business we cannot describe.
 */
// Deliberately no `promise` field.
//
// The marketing sentence used to be interpolated into the capability shot, and a video model
// reading "Show the change taking effect — An AI CMO that replaces the agency retainer —"
// has every reason to render those words on screen. Copy belongs in on-screen text, where it
// is chosen explicitly and filtered; a visual description must describe a picture. So the
// transformation is expressed through the audience's own work instead, which is context we
// have and which cannot be mistaken for a caption.
type VisualContext = { audience: string; subject: string };

const VISUAL_ROLES: Record<SceneEmotion, (c: VisualContext) => string> = {
  // Setup: the world as it is, before anything is sold.
  curiosity: (c) => `Establish the everyday working environment of ${c.audience}. The situation before anything changes — no product present in frame yet.`,
  // Problem: the friction, shown rather than captioned.
  tension: (c) => `The friction ${c.audience} live with today: effort, clutter and repeated manual work, shown through the environment and hands rather than faces.`,
  // The turn. Abstract on purpose — see the constraint block at the end of the prompt.
  confidence: (c) => `Introduce ${c.subject} as a presence rather than a screen: scattered elements resolving into order, light and motion settling. Represent it abstractly — no interface, no logo, no text.`,
  // Capability: the change happening, expressed as motion.
  delight: (c) => `Show the change taking effect: the scattered work of ${c.audience} resolving into one organised flow, elements arranging themselves into a clear structure. Abstract representation only — no interface, no text.`,
  // Relief reads as the same beat as the after-state.
  relief: (c) => `The same environment as the opening, now uncluttered and calm — the pressure on ${c.audience} visibly lifted.`,
  trust: (c) => `Steady, unhurried framing of the ordered result. Nothing hurried, nothing flashing — the visual argument is that it holds.`,
  // Outcome: the after-state, deliberately rhyming with the opening shot.
  aspiration: (c) => `The after-state for ${c.audience}: the opening environment again, now calm and in order, with room to work.`,
  // Close: a brand moment with no fabricated brand.
  urgency: () => `A closing brand moment: a clean, still end frame built from the colour palette alone. No mark, no wordmark, no invented graphic.`,
};

function visualFor(scene: Scene, brief?: CreativeBriefInput | null, product?: { name: string; summary: string } | null): string {
  const audience = (brief?.audience ?? "").trim();
  const subject = (product?.name ?? "").trim();

  // Without an audience there is nobody to put in frame, so the structural description
  // stands. This is the unanalysed-workspace path. The key message is deliberately not
  // consulted: it is copy, and copy does not belong in a visual description.
  if (!audience) return scene.visualObjective;

  return VISUAL_ROLES[scene.emotion]({ audience, subject: subject || "the service" });
}

/** The pacing half of a scene's motion notes, without the camera restatement. */
function pacingOf(motionNotes: string): string {
  const tail = motionNotes.split(";").slice(1).join(";").trim();
  if (!tail) return "";
  return `${tail.charAt(0).toUpperCase()}${tail.slice(1)}${tail.endsWith(".") ? "" : "."}`;
}

function clock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * On-screen text for a scene — but only text the brief can actually support.
 *
 * The script engine fills missing brief fields with readable placeholders ("how it works",
 * "get started", "the core promise"). Those are fine as internal scaffolding and unusable as
 * words burned into a video: they are claims about a business nobody made. So a caption is
 * emitted only when it traces back to something the brief genuinely contained, and the
 * request sentence is never eligible.
 *
 * A shot with no on-screen text is the correct outcome of an empty brief. Silence is honest;
 * filler is not.
 */
function captionFor(
  script: Script | null | undefined,
  sceneId: string,
  brief?: CreativeBriefInput | null,
): string | null {
  if (!script) return null;
  // The "hook" section's caption is the rendered hook line, which substitutes the request
  // into a template — never on-screen text.
  const section = script.sections.find((s) => s.sceneRef === sceneId && s.caption && s.label !== "hook");
  const text = section?.caption?.trim();
  if (!text) return null;

  // What the brief actually said. Anything not traceable to one of these is scaffolding.
  const supported = [brief?.keyMessage, brief?.proof, brief?.cta]
    .map((v) => (v ?? "").trim())
    .filter(Boolean);
  if (!supported.some((value) => equivalent(value, text))) return null;

  // The instruction is not copy, even if it somehow reached a supported field.
  if (brief?.objective && equivalent(brief.objective, text)) return null;

  // A single line, short enough to sit on a phone screen. Longer captions read as body copy
  // and the model renders them as unreadable paragraphs.
  return text.length > 70 ? `${text.slice(0, 67).trimEnd()}…` : text;
}

/**
 * Build the provider-facing creative direction.
 *
 * Deterministic: the same specification and duration always produce the same prompt, which
 * is what makes the storyboard shown in Studio and the text sent to the provider provably
 * the same thing rather than two renderings that drifted apart.
 */
export function buildVideoPrompt(input: VideoPromptInput): string {
  const { spec, durationSec, aspectRatio } = input;
  const lang = input.languageCode ?? DEFAULT_LANGUAGE;
  const v = spec.visualDirection;
  const scenes = spec.storyStructure?.acts.flatMap((a) => a.scenes) ?? [];
  const fitted = fitScenes(scenes, durationSec);

  const orientation = aspectRatio === "9:16" ? "vertical" : aspectRatio === "16:9" ? "widescreen" : aspectRatio;

  const lines: string[] = [];

  // --- the brief, in one paragraph a director could read aloud ---
  //
  // Audience and logline are stated only when the workspace supplied them. spec.audience
  // falls back to "founders" and the logline to "For your audience: the core promise",
  // and describing a video for an audience nobody named is direction built on nothing.
  const realAudience = (input.brief?.audience ?? "").trim();
  lines.push(
    realAudience
      ? `A ${durationSec}-second ${orientation} (${aspectRatio}) video for ${realAudience}.`
      : `A ${durationSec}-second ${orientation} (${aspectRatio}) video.`,
  );

  // Who it is for and what it sells, from the workspace's own profile — never a literal
  // from this file, so it works for any business.
  const product = productIdentity(input.profile);
  if (product) {
    lines.push(product.summary ? `Subject: ${product.name} — ${product.summary}` : `Subject: ${product.name}.`);
  }

  // The promise, unless the subject line already said it — a workspace's one-liner is
  // usually both its description and its pitch, and printing it twice reads as emphasis.
  const keyMessage = (input.brief?.keyMessage ?? "").trim();
  if (keyMessage && !(product && equivalent(product.summary, keyMessage))) {
    lines.push(`The promise: ${keyMessage}`);
  }
  // Tone, emotion and mood are three views of one thing and often collapse to the same
  // words ("calm confidence, confidence. Mood: calm confidence · confidence"). Say each
  // distinct word once: repetition in a prompt reads as emphasis the model then over-applies.
  // Split on separators only, never on spaces: a brand voice like "calm, specific, no hype"
  // is a list of phrases, and word-splitting turned its last phrase into "no, hype".
  const tonePhrases = [...new Set(
    [spec.tone, spec.emotion, v.mood]
      .join(",")
      .toLowerCase()
      .split(/[,·;]+/)
      .map((t) => t.trim())
      .filter(Boolean),
  )];
  lines.push(`Tone: ${tonePhrases.join(", ")}.`);
  lines.push(
    `Look: ${v.composition}; ${v.lighting}; ${v.framing}. ` +
    `Colour palette ${v.colorPalette.join(", ")}. Motion: ${v.motionStyle}.`,
  );

  // The hook is deliberately NOT sent.
  //
  // It is a copywriting device whose template substitutes {product} with the specification's
  // goal — which is the user's own request sentence. Rendered, that produced lines like
  // "The Create a 10-second Instagram Reel announcing Populr as an AI CMO trick founders
  // aren't talking about yet", which is not a visual instruction and is barely a sentence.
  // The opening beat is already the first shot; a renderer needs that, not the headline.

  // Language is a rendering instruction here, because the model draws the words.
  lines.push(
    isEnglish(lang)
      ? `Any on-screen text is in English.`
      : `Any on-screen text is in ${language(lang).name} (${language(lang).native}), written in ${language(lang).script} script. Do not use English text on screen.`,
  );

  // --- the shot list ---
  if (fitted.length) {
    lines.push("", "Shots:");
    let at = 0;
    for (const [i, { scene, sec }] of fitted.entries()) {
      const caption = captionFor(input.script, scene.id, input.brief);
      const parts = [
        `Shot ${i + 1} — ${clock(at)}–${clock(at + sec)} (${sec}s). ${visualFor(scene, input.brief, product)}`,
        `Camera: ${scene.camera.replace(/_/g, " ")}.`,
        // motionNotes begins by restating the camera ("slow push camera; curiosity pacing"),
        // which the previous line already said. Keep only the part that adds something.
        pacingOf(scene.motionNotes),
        caption ? `On-screen text: "${caption}".` : "",
        i < fitted.length - 1 && scene.transition !== "none" ? `Transition: ${scene.transition}.` : "",
      ].filter(Boolean);
      lines.push(parts.join(" "));
      at += sec;
    }
  }

  // --- closing constraints ---
  //
  // Both of these are honesty constraints rather than style. Populr holds no logo file and
  // no product screenshot, so a model inventing a brand mark would be putting a fabricated
  // identity on screen; and invented UI in a product video is a claim about software that
  // does not look like ours.
  const realCta = (input.brief?.cta ?? "").trim();
  const tail = [
    "",
    realCta ? `End on: ${realCta}.` : `End on a closing brand moment. Do not invent a call to action.`,
    `Constraints: no logo or brand mark of any kind; no readable product interface, screens or dashboards; ` +
    `no identifiable individuals, spokespeople or testimonials; no statistics, numbers, charts or claims; ` +
    `no text other than the on-screen text specified above.`,
  ].join("\n");

  // The constraints are never truncated.
  //
  // They used to be appended before the length cap, so a longer shot list pushed "no logo,
  // no invented UI, no fabricated claims" off the end — the one part of this prompt whose
  // absence changes what the model is allowed to draw. Room is reserved for them and only
  // the body is trimmed.
  const body = lines.join("\n").trim();
  const room = MAX_PROMPT_CHARS - tail.length - 1;
  const trimmed = body.length > room ? `${body.slice(0, room - 1).trimEnd()}…` : body;
  return `${trimmed}\n${tail}`.trim();
}

/**
 * The storyboard Studio shows — derived from the same specification and the same fitting as
 * the prompt above, so the screen and the provider can never disagree. There is one source
 * of truth and this reads it; it does not rebuild anything.
 */
export type StoryboardShot = {
  n: number;
  startSec: number;
  durationSec: number;
  description: string;
  camera: string;
  onScreenText: string | null;
};

export function storyboardOf(input: VideoPromptInput): StoryboardShot[] {
  const scenes = input.spec.storyStructure?.acts.flatMap((a) => a.scenes) ?? [];
  const fitted = fitScenes(scenes, input.durationSec);
  let at = 0;
  return fitted.map(({ scene, sec }, i) => {
    const shot: StoryboardShot = {
      n: i + 1,
      startSec: at,
      durationSec: sec,
      description: visualFor(scene, input.brief, productIdentity(input.profile)),
      camera: scene.camera.replace(/_/g, " "),
      onScreenText: captionFor(input.script, scene.id, input.brief),
    };
    at += sec;
    return shot;
  });
}
