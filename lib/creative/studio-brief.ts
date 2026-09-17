import type { CreativeBriefInput } from "@/lib/creative/types";

// The workspace's business context → a Creative Brief.
//
// This is the seam the last smoke test exposed. Studio was sending the user's request
// sentence as *both* the objective and the key message, so the intelligence layer had no
// business facts to work with and filled every gap with its own fallbacks — "founders",
// "get started", "how it works", "For your audience". Four of six shots then carried
// placeholder copy, and Shot 1 carried the request sentence itself as on-screen text.
//
// The rule this file enforces: **a request is an instruction, not copy.** What the founder
// typed tells Populr what to make. What goes on screen has to come from what Populr knows
// about the business — and where it knows nothing, the field stays empty. An empty field
// produces a shot with no on-screen text, which is a fine video. A fabricated field
// produces a video making a claim nobody made.
//
// Nothing here is specific to any one business: every value is read from the profile the
// workspace already has (the same one the composer and daily brief use), and no product
// name, tagline or CTA is written into this file.

/** The profile /api/state returns. Every field optional — a new workspace has none of them. */
export type WorkspaceProfile = {
  name?: string;
  oneLiner?: string;
  audience?: string;
  positioning?: string;
  voice?: string;
  description?: string;
};

const clean = (v: string | undefined): string => (v ?? "").trim();

/**
 * Build a Creative Brief from the request and whatever the workspace actually knows.
 *
 * Note what is *not* set. `proof`, `cta` and `successMetric` have no source in the profile,
 * so they are left empty rather than guessed. That is deliberate: the script engine's
 * fallbacks for those fields are exactly the placeholder captions this change exists to
 * remove, and the caption filter downstream drops anything the brief cannot support.
 */
export function briefFromWorkspace(request: string, profile?: WorkspaceProfile | null): CreativeBriefInput {
  const p = profile ?? {};

  // The promise the video is making. The one-liner is the business's own sentence about
  // itself, which is the closest thing to real marketing copy a workspace holds; positioning
  // is the fallback because it is a claim rather than a description.
  const keyMessage = clean(p.oneLiner) || clean(p.positioning);

  return {
    // The instruction. It steers the story format and the specification, and the prompt
    // builder never lets it become on-screen text.
    objective: clean(request),
    audience: clean(p.audience),
    keyMessage,
    // Brand voice is a tone, which is what emotionalAngle feeds.
    emotionalAngle: clean(p.voice),
    // No proof, CTA, visual direction or success metric exists in a workspace profile.
    // Left empty on purpose — see the note above.
    proof: "",
    cta: "",
    visualDirection: "",
    successMetric: "",
  };
}

/**
 * The product being talked about, when the workspace knows it.
 *
 * Returned separately from the brief because it is an identity, not a message: the prompt
 * uses it to say what is on screen, and it must never be confused with the request.
 */
export function productIdentity(profile?: WorkspaceProfile | null): { name: string; summary: string } | null {
  const name = clean(profile?.name);
  if (!name) return null;
  return { name, summary: clean(profile?.oneLiner) || clean(profile?.description) };
}

/**
 * Two strings that say the same thing, for the purpose of "is this caption just the request
 * echoed back". Punctuation and case are noise; a caption that is a truncation of the
 * request (the script engine slices) still counts as the request.
 */
export function equivalent(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9ऀ-෿ ]+/gi, " ").replace(/\s+/g, " ").trim();
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // One containing the other catches both truncation and the "…" ellipsis the caption
  // shortener adds, in either direction.
  const shorter = x.length <= y.length ? x : y;
  const longer = x.length <= y.length ? y : x;
  return shorter.length >= 12 && longer.includes(shorter);
}
