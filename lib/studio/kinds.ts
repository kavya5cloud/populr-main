import type { ContentFormat } from "@/lib/content/compose";
import type { LanguageCode } from "@/lib/i18n/languages";

// What Studio offers to make.
//
// Shortcuts, not templates. The prompt is the product — a founder should be able to say what
// they want to achieve and have Populr work out what to produce. These exist for the moment
// before someone knows what to type, and every one of them fills the prompt rather than
// bypassing it.
//
// The hard rule: a card may only describe something the pipeline actually produces today.
// Short Video, Voice Content, audio waveforms and video previews are deliberately absent —
// nothing here renders a media file. `mediaUri()` returns `populr://media/video/<hash>.mp4`,
// a synthetic locator that resolves to nothing, and a card promising a clip we cannot make
// is the failure that got the video path pulled off the marketing site.
//
// "Video script and shot list" is on the list because that is a real deliverable: it is what
// a founder takes to whoever holds the camera. The script is ours; the file is not.

export type StudioKind = {
  id: string;
  title: string;
  /** One line, what it produces. Never a claim about how good it is. */
  blurb: string;
  /** Which composer format this maps to. */
  format: ContentFormat;
  /** Seeds the prompt. The user edits it before generating — that is the point. */
  seed: string;
  /** Set only where the card's whole purpose is the language. */
  language?: LanguageCode;
  /** Which preview the card draws. Pure CSS; no assets, no third-party imagery. */
  preview: "post" | "launch" | "article" | "ad" | "email" | "multilingual" | "script" | "seo";
};

export const STUDIO_KINDS: StudioKind[] = [
  {
    id: "social",
    title: "Social campaign",
    blurb: "One idea, sized for every platform you have connected.",
    format: "post",
    seed: "A campaign about the change our product makes for the people who use it",
    preview: "post",
  },
  {
    id: "launch",
    title: "Product launch",
    blurb: "The announcement, and the week around it.",
    format: "announcement",
    seed: "We are launching something new — announce it without hype",
    preview: "launch",
  },
  {
    id: "article",
    title: "Blog or article",
    blurb: "A long-form piece from a single idea.",
    format: "blog",
    seed: "An article about the problem we solve and why the usual answer fails",
    preview: "article",
  },
  {
    id: "ad",
    title: "Ad copy",
    blurb: "Hooks and angles, written to be tested against each other.",
    format: "post",
    seed: "Ad copy for the one thing our buyers care about most",
    preview: "ad",
  },
  {
    id: "email",
    title: "Email campaign",
    blurb: "A sequence that says something, not a newsletter.",
    format: "email",
    seed: "An email to people who signed up and have not come back",
    preview: "email",
  },
  {
    id: "multilingual",
    title: "In your market's language",
    blurb: "Written natively in an Indian language, not translated.",
    format: "post",
    seed: "A post for our customers in their own language",
    // The only card that presets a language, because that is the whole of what it is for.
    language: "hi-IN",
    preview: "multilingual",
  },
  {
    id: "script",
    title: "Video script and shot list",
    blurb: "The words and the shots. You bring the camera.",
    // Its own format now, not "post". The format carries the shape — hook, numbered shots
    // with visual direction and voiceover, caption, CTA — so the seed can stay a sentence
    // the founder edits rather than a spec they have to keep intact.
    format: "video_script",
    seed: "A 30-second script and shot list explaining what we do",
    preview: "script",
  },
  {
    id: "seo",
    title: "SEO brief",
    blurb: "What to write, and what not to bother ranking for.",
    format: "blog",
    seed: "An SEO brief for the term our buyers actually search",
    preview: "seo",
  },
];

export function studioKind(id: string): StudioKind | undefined {
  return STUDIO_KINDS.find((k) => k.id === id);
}
