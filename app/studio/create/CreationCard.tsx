"use client";

import type { StudioKind } from "@/lib/studio/kinds";

// The card and its preview.
//
// Every preview is drawn in CSS from divs. No screenshots, no stock imagery, no third-party
// assets — partly because those carry licences we would have to honour, and mostly because a
// photograph of software is not a preview of anything. What these show is the *shape* of the
// thing: a post has a header and two lines and a row of tags; an email has a subject line
// and a button. That is enough to tell them apart at a glance, which is the whole job.
//
// Deliberately abstract rather than a fake rendering with lorem text. A convincing mock of a
// finished asset is a promise about the output, and we do not know yet what the output says.

function Preview({ kind }: { kind: StudioKind["preview"] }) {
  switch (kind) {
    case "post":
      return (
        <div className="stu-pv stu-pv-post" aria-hidden="true">
          <span className="stu-pv-avatar" />
          <span className="stu-pv-line w70" />
          <span className="stu-pv-line w90" />
          <span className="stu-pv-line w50" />
          <span className="stu-pv-tags"><i /><i /><i /></span>
        </div>
      );
    case "launch":
      return (
        <div className="stu-pv stu-pv-launch" aria-hidden="true">
          <span className="stu-pv-day">MON</span>
          <span className="stu-pv-bars"><i style={{ height: "34%" }} /><i style={{ height: "62%" }} /><i style={{ height: "88%" }} /><i style={{ height: "48%" }} /><i style={{ height: "70%" }} /></span>
          <span className="stu-pv-line w60" />
        </div>
      );
    case "article":
      return (
        <div className="stu-pv stu-pv-article" aria-hidden="true">
          <span className="stu-pv-h" />
          <span className="stu-pv-line w95" />
          <span className="stu-pv-line w88" />
          <span className="stu-pv-line w92" />
          <span className="stu-pv-line w40" />
        </div>
      );
    case "ad":
      return (
        <div className="stu-pv stu-pv-ad" aria-hidden="true">
          <span className="stu-pv-frame" />
          <span className="stu-pv-line w80" />
          <span className="stu-pv-cta" />
        </div>
      );
    case "email":
      return (
        <div className="stu-pv stu-pv-email" aria-hidden="true">
          <span className="stu-pv-subject" />
          <span className="stu-pv-line w85" />
          <span className="stu-pv-line w70" />
          <span className="stu-pv-cta" />
        </div>
      );
    case "multilingual":
      // Real scripts, from the languages the system actually supports. A row of flags would
      // be a claim about countries; these are a claim about scripts, which is what we do.
      return (
        <div className="stu-pv stu-pv-lang" aria-hidden="true">
          <span>अ</span><span>ব</span><span>ਪ</span>
          <span>த</span><span>ಕ</span><span>ଓ</span>
        </div>
      );
    case "script":
      return (
        <div className="stu-pv stu-pv-script" aria-hidden="true">
          <span className="stu-pv-shot"><i>01</i><em /></span>
          <span className="stu-pv-shot"><i>02</i><em /></span>
          <span className="stu-pv-shot"><i>03</i><em /></span>
        </div>
      );
    case "seo":
      return (
        <div className="stu-pv stu-pv-seo" aria-hidden="true">
          <span className="stu-pv-rank"><i>1</i><em className="w70" /></span>
          <span className="stu-pv-rank"><i>2</i><em className="w55" /></span>
          <span className="stu-pv-rank stu-pv-out"><i>—</i><em className="w45" /></span>
        </div>
      );
  }
}

export default function CreationCard({ kind, onPick }: { kind: StudioKind; onPick: (k: StudioKind) => void }) {
  return (
    <button
      type="button"
      className="stu-card"
      onClick={() => onPick(kind)}
      // The card fills the prompt; it does not generate. Said out loud because a card that
      // silently started a generation would take the decision away from the person.
      aria-label={`${kind.title} — ${kind.blurb}. Fills the prompt so you can edit it.`}
    >
      <span className="stu-card-pv"><Preview kind={kind.preview} /></span>
      <span className="stu-card-t">{kind.title}</span>
      <span className="stu-card-d">{kind.blurb}</span>
    </button>
  );
}
