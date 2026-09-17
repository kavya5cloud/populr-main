import Composer from "../Composer";

// Video script and shot list.
//
// This page used to offer "Hero Launch Video" and "Product Demo" behind a Generate button.
// Pressing it started a Job whose overlay said "Rendering visuals" and then "Done", and
// nothing was ever rendered — there is no video provider and no renderer anywhere in this
// codebase. The cards are gone.
//
// What is left is the part that was always real. Populr writes the hook, the numbered
// shots, the visual direction, the on-screen text, the voiceover, the caption and the CTA:
// the pages a founder hands to whoever is filming. That goes through the same Composer,
// the same /api/content/compose, the same craft grading and the same language system as
// every other piece of writing in the product. There is no second generation backend here.
//
// The heading says "you bring the camera" above the fold rather than in a footnote, because
// the whole failure this page is fixing was a promise made in bigger type than its caveat.

export default function VideoScript() {
  return (
    <section className="st-section">
      <header className="st-shead">
        <span className="label">Video</span>
        <h1>Video script and shot list</h1>
        <p>
          Populr writes the script, the shot list and the caption. You bring the camera —
          Populr does not film or render video.
        </p>
      </header>

      <Composer
        initialFormat="video_script"
        heading="What should the video be about?"
      />
    </section>
  );
}
