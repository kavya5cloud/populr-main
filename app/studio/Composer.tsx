"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_LANGUAGE, LANGUAGES, LANGUAGE_CODES, localeLabel, type LanguageCode } from "@/lib/i18n/languages";
import { CONTENT_FORMATS, FORMAT_META, type ContentFormat } from "@/lib/content/compose";
import type { SocialPlatform } from "@/lib/social/types";
import { humanError, humanThrow } from "@/lib/ui/errors";
import { connectedPlatforms, workspaceProfile, resetWorkspaceContext } from "@/lib/studio/workspace-context";
import { loadState, saveState } from "@/lib/store";
import type { WorkspaceProfile } from "@/lib/creative/studio-brief";

// The Content Studio: brief → draft → ship.
//
// The shape of this screen makes one argument: Populr already knows the business, so the
// only thing a founder should have to supply is what they want to achieve. Everything
// follows from that —
//
//   - the brief is the hero, and it looks like a surface you write on
//   - what Populr already knows is stated above it, so the brief need not repeat it
//   - format, audience and language are still here and still reach the API unchanged;
//     they sit behind Options because configuring a post is not how writing one starts
//   - the finished piece is the hero of the second state; how it was made is in Details
//
// Nothing was removed. Language, format, audience, streaming variants, selection
// refinement, drafts, scheduling, publishing, provenance and refusal handling all work
// exactly as before, against exactly the same endpoints.

type Variant = { platform: SocialPlatform; text: string; length: number; limit: number; fits: boolean; requiresAsset: boolean; note: string };
type Composed = {
  id: string; format: ContentFormat; title: string; body: string;
  variants: Variant[]; hashtags: string[]; ctas: string[];
  schedule: { platform: SocialPlatform; at: number; rationale: string }[];
  campaignSuggestion: { title: string; goal: string; rationale: string };
};
type Result = { platform: SocialPlatform; jobId: string; state: string; at: number | null; error?: string };
/** Where the words came from. Kept, moved into Details — see the note at its render site. */
type Provenance = {
  source: "llm" | "deterministic"; provider: string | null; model: string | null;
  confidence: number; reasoning: string; degradedReason?: string;
};

/**
 * Starting points, not templates.
 *
 * Each one fills the brief and stops. Nothing here fires a request — a card that silently
 * started a paid generation would take the decision away from the person, and the whole
 * argument of this screen is that they are directing the work.
 */
const STARTERS: { label: string; hint: string; prompt: string }[] = [
  { label: "Launch announcement", hint: "Something shipped", prompt: "Announce the feature we shipped this week and what it removes for the people using it" },
  { label: "Product update", hint: "What changed, and why", prompt: "Explain what we rebuilt in our onboarding and what is different now" },
  { label: "Thought leadership", hint: "A position worth holding", prompt: "The thing everyone in our market gets wrong, and what we do instead" },
  { label: "Explainer", hint: "For someone new", prompt: "Explain what we do to someone who has never heard of us" },
];

/** The eleven refinements the API accepts, grouped so the toolbar reads as a menu. */
const REFINE_GROUPS: { label: string; items: [string, string][] }[] = [
  { label: "Edit", items: [["rewrite", "Rewrite"], ["shorten", "Shorten"], ["expand", "Expand"], ["improve", "Improve"]] },
  { label: "Tone", items: [["professional", "Professional"], ["casual", "Casual"], ["engaging", "Engaging"]] },
  { label: "Add", items: [["cta", "Call to action"], ["hashtags", "Hashtags"], ["continue", "Continue"], ["grammar", "Fix grammar"]] },
];

const when = (t: number) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * @param initialPrompt Seeds the brief. Studio's cards fill it rather than bypassing it.
 * @param initialLanguage Preset by the one card whose purpose is the language.
 *
 * Both are read once. Studio remounts this component with a new `key` when a card is
 * picked, which is cheaper and less error-prone than syncing two sources of the same state.
 */
export default function Composer({
  initialFormat = "post" as ContentFormat,
  initialPrompt = "",
  initialLanguage = DEFAULT_LANGUAGE,
  heading,
  chrome = true,
}: {
  initialFormat?: ContentFormat;
  initialPrompt?: string;
  initialLanguage?: LanguageCode;
  heading?: string;
  /**
   * Whether this Composer owns the page.
   *
   * On /studio it does, and it renders its own title, the context line and the starter
   * cards. Embedded in /studio/create it does not: that page already has a heading, a
   * context line and an eight-card deck, and rendering a second set produced the same
   * sentence twice in a row, two <h1>s (one empty) and twelve cards competing for one
   * decision. A host page that supplies its own framing passes chrome={false}.
   */
  chrome?: boolean;
}) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [format, setFormat] = useState<ContentFormat>(initialFormat);
  /**
   * Empty by default.
   *
   * This used to be pre-filled with "seed-stage founders" for every workspace, which made
   * the panel's own promise — that Populr infers the audience — false on its face, and gave
   * a freight business copy written for startups. Empty means the server infers, which is
   * what the note underneath has always claimed.
   */
  const [audience, setAudience] = useState("");
  // The default lives in lib/i18n/languages.ts. Writing "en-IN" here would be a second
  // source of truth that drifts the first time the default changes.
  const [language, setLanguage] = useState<LanguageCode>(initialLanguage);
  const [advanced, setAdvanced] = useState(false);

  const [composed, setComposed] = useState<Composed | null>(null);
  const [connected, setConnected] = useState<string[]>([]);
  const [profile, setProfile] = useState<WorkspaceProfile | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [meta, setMeta] = useState<Provenance | null>(null);
  /** "" is the full piece; otherwise the platform whose variant is being read. */
  const [tab, setTab] = useState<string>("");
  const [details, setDetails] = useState(false);
  /** Publishing everywhere is irreversible, so it asks once. */
  const [confirmPublish, setConfirmPublish] = useState(false);

  /**
   * Edits per version, keyed by tab. Independent by construction: editing the LinkedIn
   * variant cannot touch X, because they are different keys.
   */
  const [edits, setEdits] = useState<Record<string, string>>({});
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  /**
   * In-flight latch for anything that costs a request.
   *
   * `busy` is state, so two clicks inside one tick both read the stale value and both
   * fire — a disabled attribute does not help either, because React has not re-rendered
   * yet. A ref is written synchronously, so the second click sees it immediately. Tested
   * with two clicks and no delay between them, which is what a real double-click is.
   */
  const inFlight = useRef(false);
  const [sel, setSel] = useState<{ start: number; end: number; top: number } | null>(null);
  const [refining, setRefining] = useState<string | null>(null);
  /** A refinement not yet accepted. Keeping the original is what makes reject possible. */
  const [pending, setPending] = useState<{ start: number; end: number; original: string; next: string } | null>(null);

  // One request each per page load, shared across every Composer that mounts. See
  // lib/studio/workspace-context.ts for why this is not a per-mount fetch.
  useEffect(() => {
    let live = true;
    void connectedPlatforms().then((p) => { if (live) setConnected(p); });
    void workspaceProfile().then((p) => {
      if (!live) return;
      setProfile(p);
      // The workspace's own language, so a founder who set Marathi once does not reset it on
      // every visit. Skipped when a card preset a language on purpose — that card exists to
      // override the default for one post, and the saved preference should not fight it.
      if (initialLanguage === DEFAULT_LANGUAGE && p?.language) setLanguage(p.language);
    });
    return () => { live = false; };
  }, [initialLanguage]);

  // Changing the language is a workspace decision, not a per-post one, so it is written back
  // to the same profile the automated path reads with getWorkspaceLanguage(). Without this a
  // scheduled post would keep going out in English while the composer showed Marathi.
  const changeLanguage = useCallback((next: LanguageCode) => {
    setLanguage(next);
    void loadState().then(({ saved }) => {
      if (!saved?.profile || saved.profile.language === next) return;
      saveState({ ...saved, profile: { ...saved.profile, language: next } });
      // The page-load profile cache now holds a stale language, and Composer remounts on
      // every card click — without this the select would snap back to the old language.
      resetWorkspaceContext();
    });
  }, []);

  const call = useCallback(async (body: Record<string, unknown>, tag: string) => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setBusy(tag); setErr(null); setNote(null);
    try {
      const r = await fetch("/api/content/compose", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, format, audience, language, ...body }),
      });
      const d = await r.json();
      if (!r.ok || d.error) { setErr(humanError(d, r.status)); return null; }
      return d;
    } catch (e) { setErr(humanThrow(e)); return null; }
    finally { inFlight.current = false; setBusy(null); }
  }, [prompt, format, audience, language]);

  const readMeta = (d: Record<string, unknown>) => setMeta({
    source: d.source as Provenance["source"], provider: d.provider as string | null,
    model: d.model as string | null, confidence: d.confidence as number,
    reasoning: d.reasoning as string, degradedReason: d.degradedReason as string | undefined,
  });

  const generate = useCallback(async () => {
    if (!prompt.trim()) { setErr("Tell Populr what you're working on first."); return; }
    // First gate only — the real one is the inFlight ref inside call(), because state
    // has not updated yet when a second click lands in the same tick.
    if (busy || inFlight.current) return;
    const d = await call({}, "gen");
    if (d?.ok) { setComposed(d.composed); setResults(null); setTab(""); setConfirmPublish(false); if (d.note) setNote(d.note); readMeta(d); }
  }, [call, prompt, busy]);

  const publish = useCallback(async (action: "draft" | "schedule" | "now") => {
    if (busy || inFlight.current) return;
    // Publish what the user is looking at. Edits would otherwise be silently discarded.
    const d = await call({ publish: action, overrides: edits }, action);
    if (d?.ok) { setComposed(d.composed); setResults(d.results); setNote(d.message); readMeta(d); setConfirmPublish(false); }
  }, [call, edits, busy]);

  const active = composed?.variants.find((v) => v.platform === tab);
  const generated = active ? active.text : composed?.body ?? "";
  /** What is actually in the editor: the user's edit if they made one, else the generation. */
  const bodyText = edits[tab] ?? generated;

  // Fresh generations replace the editor; edits to other tabs are untouched.
  useEffect(() => { setEdits({}); setPending(null); setSel(null); }, [composed?.id]);

  const setBody = useCallback((next: string) => {
    setEdits((e) => ({ ...e, [tab]: next }));
  }, [tab]);

  /**
   * Grow both textareas to fit their content.
   *
   * The old editor sized itself with `rows` counted from newline characters, so a single
   * long paragraph was "one line" and got six rows — with `overflow:hidden` and
   * `resize:none`, 78px of the user's own post was unreachable at 375px. Measuring
   * scrollHeight counts wrapped lines, which is the thing that was actually wrong.
   */
  const autosize = useCallback((el: HTMLTextAreaElement | null, min: number) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(min, el.scrollHeight)}px`;
  }, []);

  // Two lines of the 18px face. The old 128px floor is what produced the dead area.
  useEffect(() => { autosize(promptRef.current, 52); }, [prompt, composed, autosize]);
  // 54px ≈ two lines. The old 160px floor left a ~100px hole under a short post.
  useEffect(() => { autosize(editorRef.current, 54); }, [bodyText, tab, autosize]);

  /**
   * Re-measure when the box itself changes width.
   *
   * Height was only recomputed when the text changed, so rotating a phone or narrowing a
   * window rewrapped the content taller than the height set at the old width — and clipped
   * it, which is exactly the bug this autosizing replaced. A ResizeObserver on the element
   * catches every cause of a width change, including ones a window listener misses.
   */
  useEffect(() => {
    const el = editorRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => autosize(el, 54));
    ro.observe(el);
    return () => ro.disconnect();
  }, [composed?.id, autosize]);

  /** Track the selection so the toolbar can act on exactly what is highlighted. */
  const readSelection = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const { selectionStart: start, selectionEnd: end } = el;
    if (start === end) { setSel(null); return; }
    // Position the toolbar near the selection without measuring glyphs: line height
    // times the line the selection starts on is close enough and never wrong by much.
    const line = el.value.slice(0, start).split("\n").length - 1;
    setSel({ start, end, top: Math.max(0, line * 27 - el.scrollTop) });
  }, []);

  // Cleared on unmount: without it a blur during teardown leaves a timer holding a setState.
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (blurTimer.current) clearTimeout(blurTimer.current); }, []);

  const refine = useCallback(async (action: string) => {
    const el = editorRef.current;
    if (!el) return;
    const start = sel?.start ?? el.selectionStart;
    const end = sel?.end ?? el.selectionEnd;
    const text = bodyText;
    const selection = text.slice(start, end);
    if (!selection && action !== "continue") return;
    if (refining || inFlight.current) return;

    inFlight.current = true;
    setRefining(action); setErr(null);
    try {
      const r = await fetch("/api/content/refine", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action, selection,
          before: text.slice(0, start), after: text.slice(end),
          platform: tab || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok || d.error) { setErr(String(d.hint || "That edit didn't go through. Your text is unchanged.")); return; }

      const insert = action === "continue" ? `${selection}${selection ? " " : ""}${d.text}` : d.text;
      // Show the change in place, but hold it as pending until it is accepted — an AI
      // edit that silently overwrites your sentence is one you cannot get back.
      setPending({ start, end, original: selection, next: insert });
      setBody(text.slice(0, start) + insert + text.slice(end));
      setSel(null);
    } catch { setErr("Network error — your text is unchanged."); }
    finally { inFlight.current = false; setRefining(null); }
  }, [sel, bodyText, tab, setBody, refining]);

  const rejectPending = useCallback(() => {
    if (!pending) return;
    const text = bodyText;
    setBody(text.slice(0, pending.start) + pending.original + text.slice(pending.start + pending.next.length));
    setPending(null);
  }, [pending, bodyText, setBody]);

  const edited = edits[tab] !== undefined && edits[tab] !== generated;

  /** What Populr already knows, stated rather than asked for. */
  const context = useMemo(() => {
    const items: [string, string][] = [];
    if (profile?.name) items.push(["Business", profile.name]);
    const who = audience.trim() || profile?.audience?.trim();
    if (who) items.push(["Audience", who]);
    items.push(["Language", localeLabel(language)]);
    return items;
  }, [profile, audience, language]);

  return (
    <div className="cmp">
      {/* ---- Brief ---- */}
      <div className="cmp-write">
        {chrome && (
          <>
            <div className="cmp-head">
              <span className="cmp-eyebrow">Create</span>
              {/* `heading ?? …` let an empty string through and rendered a 0px <h1>. */}
              <h1 className="cmp-ask" id="cmp-ask">{heading || "What are we making?"}</h1>
            </div>

            {/* What Populr is bringing to the request, said before the box rather than asked
                for inside it. This is the difference between a prompt and a brief. */}
            <div className="cmp-ctx">
              {profile?.name ? (
                context.map(([k, v]) => <span key={k} className="cmp-ctx-i"><em>{k}</em>{v}</span>)
              ) : (
                <span className="cmp-ctx-empty">
                  No business analysed yet — <a href="/app">add your site</a> and Populr writes from
                  what it finds rather than from the brief alone.
                </span>
              )}
            </div>
          </>
        )}

        {/* The composer.
            One surface, not a bordered box containing another bordered box: the textarea
            is transparent and unbordered, and the panel around it is the input. It sizes
            to its content from a two-line floor, so a one-line brief no longer sits above
            a hundred pixels of nothing. */}
        <div className={"cmp-composer" + (busy === "gen" ? " working" : "")}>
          <textarea
            ref={promptRef}
            id="cmp-prompt" className="cmp-prompt" value={prompt}
            aria-label="What are we making?"
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              // Cmd/Ctrl+Enter generates. Plain Enter is a newline — a brief is prose, and
              // submitting on Enter would cost a request every time someone paragraphs.
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void generate(); }
            }}
            placeholder="Tell Populr what you're working on — what you want to announce, explain, launch or promote…"
            rows={1}
          />

          {/* No attachment control: /api/content/compose takes no files, and an affordance
              for something the endpoint cannot receive is a promise the product breaks. */}
          <div className="cmp-bar">
            <button className="cmp-adv-toggle" type="button" aria-expanded={advanced} aria-controls="cmp-options" onClick={() => setAdvanced((v) => !v)}>
              {/* A language chosen and then hidden behind a closed panel is a setting someone
                  forgets they changed, and the next post comes out in a language they did not
                  expect. English says nothing; anything else says itself. */}
              {advanced ? "Hide options" : language === DEFAULT_LANGUAGE ? "Options" : `Options · ${LANGUAGES[language].native}`}
            </button>
            <button className="cmp-go" onClick={generate} disabled={busy === "gen" || !prompt.trim()}>
              {busy === "gen" ? "Writing…" : composed ? "Write it again" : "Generate"}
              {/* Beside the label rather than adrift at the far edge of the composer. */}
              <kbd className="cmp-kbd">⌘↵</kbd>
            </button>
          </div>
        </div>

        {/* Everything Populr already infers, still changeable when someone wants to. */}
        {advanced && (
          <div className="cmp-adv" id="cmp-options">
            <div className="cmp-adv-row">
              {/* First, because it is the one field here Populr cannot infer. Format and
                  audience have defaults derived from the site and from what has performed;
                  the language a business markets in is a decision only its owner can make. */}
              <label className="cmp-adv-field">
                <span>Language</span>
                <select className="cmp-select" value={language} onChange={(e) => changeLanguage(e.target.value as LanguageCode)}>
                  {LANGUAGE_CODES.map((c) => <option key={c} value={c}>{localeLabel(c)}</option>)}
                </select>
              </label>
              <label className="cmp-adv-field">
                <span>Format</span>
                <select className="cmp-select" value={format} onChange={(e) => setFormat(e.target.value as ContentFormat)}>
                  {CONTENT_FORMATS.map((f) => <option key={f} value={f}>{FORMAT_META[f].label}</option>)}
                </select>
              </label>
              <label className="cmp-adv-field">
                <span>Audience</span>
                <input
                  className="cmp-input" value={audience} onChange={(e) => setAudience(e.target.value)}
                  placeholder={profile?.audience || "Populr will work it out"}
                />
              </label>
            </div>
            <p className="cmp-adv-note">
              Left alone, Populr infers these from your site and what has performed before.
              {connected.length === 0 && " No platforms are connected yet — connect one in Publishing for sized variants and one-click publishing."}
            </p>
          </div>
        )}

        {/* Starting points. They fill the brief and stop; nothing here calls the API. They
            stay on screen while Populr works, because a screen that empties itself during
            the longest wait in the product is the wrong direction to move. */}
        {chrome && !composed && (
          <div className="cmp-starters">
            <span className="cmp-starters-h">Or start from one of these</span>
            <div className="cmp-starter-grid">
              {STARTERS.map((s) => (
                <button key={s.label} type="button" className="cmp-starter" onClick={() => { setPrompt(s.prompt); promptRef.current?.focus(); }}>
                  <span className="cmp-starter-t">{s.label}</span>
                  <span className="cmp-starter-h2">{s.hint}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {err && <div className="cmp-err" role="alert">{err}</div>}
      {note && <div className="cmp-note-line">{note}</div>}

      {/* ---- Working ---- */}
      {busy === "gen" && !composed && (
        <div className="cmp-working" aria-live="polite">
          {/* One state, because the backend reports one. docs/generation-progress.md records
              what a real phase list would require; inventing the phases on a timer would be
              theatre, and this product does not do that. */}
          <p className="cmp-working-t">Populr is writing…</p>
          <p className="cmp-working-s">Reading your business, finding the angle, then writing. Usually under a minute.</p>
          <div className="cmp-skel" aria-hidden="true">
            <span className="cmp-skel-h" /><span className="cmp-skel-l" /><span className="cmp-skel-l" />
            <span className="cmp-skel-l short" />
          </div>
        </div>
      )}

      {/* ---- The piece ---- */}
      {composed && (
        <div className="cmp-doc">
          {composed.variants.length > 0 && (
            <div className="cmp-tabs" role="tablist" aria-label="Version">
              <button role="tab" aria-selected={tab === ""} className={"cmp-tab" + (tab === "" ? " on" : "")} onClick={() => setTab("")}>
                Full piece
              </button>
              {composed.variants.map((v) => (
                <button key={v.platform} role="tab" aria-selected={tab === v.platform}
                  className={"cmp-tab" + (tab === v.platform ? " on" : "")} onClick={() => setTab(v.platform)}>
                  {v.platform}
                  <span className={"cmp-tab-n" + (v.fits ? "" : " over")}>{v.length}</span>
                </button>
              ))}
            </div>
          )}

          <article className="cmp-piece">
            {tab === "" && <h2 className="cmp-title">{composed.title}</h2>}

            {/* The document is the editor. Highlight anything to bring Populr to it. */}
            <div className="cmp-editor">
              <textarea
                ref={editorRef}
                className="cmp-body cmp-editable"
                value={bodyText}
                aria-label="Your content"
                onChange={(e) => { setBody(e.target.value); setPending(null); }}
                onSelect={readSelection}
                onKeyUp={readSelection}
                onMouseUp={readSelection}
                onBlur={() => { blurTimer.current = setTimeout(() => setSel(null), 160); }}
                rows={1}
              />

              {sel && !pending && (
                <div className="cmp-float" role="toolbar" aria-label="Refine the selection">
                  {REFINE_GROUPS.map((g) => (
                    <span key={g.label} className="cmp-float-g">
                      <span className="cmp-float-l">{g.label}</span>
                      {g.items.map(([id, label]) => (
                        <button key={id} className="cmp-float-b" disabled={refining !== null}
                          onMouseDown={(e) => e.preventDefault()} onClick={() => refine(id)}>
                          {refining === id ? "…" : label}
                        </button>
                      ))}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {pending && (
              <div className="cmp-pending">
                <span>Populr rewrote this.</span>
                <button className="cmp-alt cmp-accept" onClick={() => setPending(null)}>Keep</button>
                <button className="cmp-alt" onClick={rejectPending}>Undo</button>
              </div>
            )}

            {tab === "" && composed.hashtags.length > 0 && <p className="cmp-tags">{composed.hashtags.join("  ")}</p>}
            {active && !active.fits && <p className="cmp-note">{active.note}</p>}
            {edited && (
              <p className="cmp-edited">
                Edited. <button className="cmp-linkbtn" onClick={() => { setEdits((e) => { const n = { ...e }; delete n[tab]; return n; }); setPending(null); }}>Revert to the original</button>
              </p>
            )}
            {!sel && !pending && <p className="cmp-tip">Highlight any sentence to rewrite, shorten or change its tone.</p>}
          </article>

          {/* Ship. Saving is the safe default and gets the primary weight; publishing to
              every connected account is irreversible, so it asks first. */}
          <div className="cmp-publish">
            <button className="cmp-go" disabled={busy === "draft"} onClick={() => publish("draft")}>
              {busy === "draft" ? "Saving…" : "Save as draft"}
            </button>
            <button className="cmp-alt" disabled={busy === "schedule"} onClick={() => publish("schedule")}>
              {busy === "schedule" ? "Scheduling…" : "Schedule"}
            </button>
            {confirmPublish ? (
              <span className="cmp-confirm">
                <span>
                  {connected.length
                    ? `Publish to ${connected.join(", ")} now?`
                    : "No platforms are connected — this will be saved instead."}
                </span>
                <button className="cmp-alt cmp-accept" disabled={busy === "now"} onClick={() => publish("now")}>
                  {busy === "now" ? "Publishing…" : "Yes, publish"}
                </button>
                <button className="cmp-alt" onClick={() => setConfirmPublish(false)}>Cancel</button>
              </span>
            ) : (
              <button className="cmp-alt" onClick={() => setConfirmPublish(true)}>
                {connected.length ? `Publish to ${connected.length} platform${connected.length === 1 ? "" : "s"}` : "Publish"}
              </button>
            )}
            <button className="cmp-adv-toggle" type="button" aria-expanded={details} aria-controls="cmp-details" onClick={() => setDetails((v) => !v)}>
              {details ? "Hide details" : "Details"}
            </button>
          </div>

          {results && (
            <div className="cmp-result">
              {results.map((r) => (
                <p key={r.jobId}><b>{r.platform}</b> — {r.state}{r.at ? ` · ${when(r.at)}` : ""}{r.error ? ` · ${r.error}` : ""}</p>
              ))}
              <p className="lw-muted">Retries, failures and approvals live in <a href="/studio/social">Publishing</a>.</p>
            </div>
          )}

          {/* Details. Everything true about how this was made, one click away rather than
              on top of the work. Provenance is a product requirement and is preserved in
              full — it just is not the first thing a founder reads about their own post. */}
          {details && (
            <section className="cmp-sub" id="cmp-details">
              {meta && (
                <dl className="cmp-dl">
                  <dt>Written by</dt>
                  <dd>
                    {/* Which model wrote it is not the customer's business and changes with a
                        provider outage. Whether a model wrote it at all is very much their
                        business, so that distinction stays and only the vendor name goes. */}
                    {meta.source === "llm" ? "Populr" : "Populr's built-in composer"}
                    {language !== DEFAULT_LANGUAGE && ` · ${localeLabel(language)}`}
                  </dd>
                  <dt>The angle</dt>
                  <dd>{meta.reasoning}</dd>
                  <dt>Confidence</dt>
                  <dd>
                    {Math.round(meta.confidence * 100)}%
                    {meta.degradedReason && <span className="lw-muted"> · {meta.degradedReason}</span>}
                  </dd>
                </dl>
              )}
              <dl className="cmp-dl">
                <dt>Call to action</dt>
                <dd>{composed.ctas.join(" · ")}</dd>
                <dt>Schedule</dt>
                <dd>
                  {composed.schedule.length
                    ? composed.schedule.map((sl) => (
                      <span key={sl.platform} className="cmp-slot"><b>{sl.platform}</b> {when(sl.at)} <span className="lw-muted">{sl.rationale}</span></span>
                    ))
                    : <span className="lw-muted">Connect a platform to get a schedule.</span>}
                </dd>
                <dt>Campaign</dt>
                <dd>
                  {composed.campaignSuggestion.title} <span className="lw-muted">{composed.campaignSuggestion.rationale}</span>{" "}
                  <a href="/studio/launch#campaigns">Open Launch Workspace →</a>
                </dd>
              </dl>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
