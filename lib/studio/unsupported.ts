// Studio surfaces that named an asset Populr cannot produce.
//
// /studio/images and /studio/motion each showed a grid of asset kinds with a Generate
// button. Pressing it created a real Job, and the Job Engine's stages ran — but the
// `generating` stage returns a string (`populr://asset/...`), not a file. There is no image
// provider and no renderer. The overlay played "Rendering visuals", said Done, and closed
// having handed the user nothing.
//
// So they redirect. Not deleted: the taxonomy entries, the planner's asset kinds and the
// Job Engine all still know about images and motion, because the *planner* recommending
// "you need a motion graphic" is true and useful. What was false was the button claiming
// Populr would make it.
//
// This is a list rather than a flag on purpose. NEXT_PUBLIC_SHOW_CONTENT_ENGINE gates
// whether the content engine exists at all, and it is on in production because the engine
// works. These two routes are not a staged rollout — they are surfaces that should not
// exist until something renders, and no flag value should bring them back.

/** Routes whose generate action cannot produce the asset the page names. */
export const UNSUPPORTED_MEDIA_PATHS = ["/studio/images", "/studio/motion"] as const;

/** Where an unsupported surface sends people: the creation surface that does work. */
export const STUDIO_FALLBACK = "/studio/create";

export function isUnsupportedMediaPath(pathname: string): boolean {
  const p = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return (UNSUPPORTED_MEDIA_PATHS as readonly string[]).includes(p);
}
