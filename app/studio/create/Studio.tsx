"use client";

import { useEffect, useRef, useState } from "react";
import Composer from "../Composer";
import CreationCard from "./CreationCard";
import VideoGenerator from "./VideoGenerator";
import { STUDIO_KINDS, type StudioKind } from "@/lib/studio/kinds";
import { workspaceId } from "@/lib/store";
import { DEFAULT_LANGUAGE, localeLabel } from "@/lib/i18n/languages";
import type { WorkspaceProfile } from "@/lib/creative/studio-brief";

// Populr Studio.
//
// The argument this screen has to make is that Populr already knows the business, so a
// founder can say what they want to *achieve* rather than pick a template and fill it in.
// Everything here follows from that:
//
//   - the prompt is the product, and the cards only fill it
//   - the context line above the prompt states what Populr already knows, so the prompt does
//     not have to repeat it
//   - there is no template gallery, no chooser, no wizard step before the box
//
// It owns no generation logic. Composer already handles the request, the streaming, the
// language, the craft rewrite, the per-platform variants and publishing; this is the surface
// around it. Picking a card remounts Composer with a new `key` and a seeded prompt, which is
// cheaper and less fragile than lifting Composer's state up here to keep two copies in step.

// The whole profile, not a three-field slice of it. The video brief reads oneLiner,
// positioning and voice, and a narrowed type here silently starved it of exactly the
// fields that keep placeholder copy out of a generated video.
type Ctx = WorkspaceProfile & { url?: string };

export default function Studio() {
  // What Populr already knows about this business, read from the same profile the composer
  // and the daily brief use. Absent for a workspace that has never been analysed, and the
  // line says so rather than inventing a business.
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [pick, setPick] = useState<StudioKind | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/state?wsid=${encodeURIComponent(workspaceId())}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (d?.state?.profile) setCtx(d.state.profile as Ctx); })
      .catch(() => {});   // context is a nicety; the composer works without it
  }, []);

  function choose(kind: StudioKind) {
    setPick(kind);
    // Bring the box back into view: on a phone the deck is below the fold and a card that
    // fills a prompt you cannot see reads as a card that did nothing.
    requestAnimationFrame(() => {
      composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  const language = pick?.language ?? DEFAULT_LANGUAGE;

  return (
    <section className="stu">
      <header className="stu-head">
        <span className="label">Studio</span>
        <h1 className="stu-h1">What are we making?</h1>
        <p className="stu-sub">
          Tell Populr what you want to achieve. It already knows the business — it works out
          what to create.
        </p>
      </header>

      {/* What Populr is bringing to the request, stated before the box rather than hidden in
          a settings panel. This is the difference between a prompt and a brief. */}
      <div className="stu-ctx">
        {ctx?.name ? (
          <>
            <span className="stu-ctx-i"><em>Business</em>{ctx.name}</span>
            {ctx.audience && <span className="stu-ctx-i"><em>Audience</em>{ctx.audience}</span>}
            <span className="stu-ctx-i"><em>Language</em>{localeLabel(language)}</span>
          </>
        ) : (
          <span className="stu-ctx-empty">
            No business analysed yet — <a href="/app">add your site</a> and Populr writes from
            what it finds rather than from the prompt alone.
          </span>
        )}
      </div>

      {/* The composer is the primary action, so it comes before the cards and gets the room.
          Remounted on pick: `key` gives it the seeded prompt without a second copy of state. */}
      <div className="stu-composer" ref={composerRef}>
        <Composer
          key={pick?.id ?? "blank"}
          // This page supplies its own heading, context line and card deck.
          chrome={false}
          initialFormat={pick?.format ?? "post"}
          initialPrompt={pick?.seed ?? ""}
          initialLanguage={language}
        />
      </div>

      {/* The one real media path. Offered only on the video-script card, and only once the
          person has written what the video is about — a Generate button above an empty box
          would be asking them to buy a render of nothing. */}
      {pick?.id === "script" && <VideoGenerator prompt={pick.seed} language={language} profile={ctx} />}

      <div className="stu-deck-head">
        <span className="label">Or start from one of these</span>
        <span className="stu-deck-note">Each one fills the box. Edit it before you generate.</span>
      </div>

      {/* Horizontal on every width. The deck is a browse, not a form — a grid of eight would
          compete with the composer for the eye, which is the opposite of the point. */}
      <div className="stu-deck" role="list">
        {STUDIO_KINDS.map((k) => (
          <div role="listitem" key={k.id}>
            <CreationCard kind={k} onPick={choose} />
          </div>
        ))}
      </div>
    </section>
  );
}
