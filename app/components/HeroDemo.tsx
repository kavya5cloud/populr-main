"use client";

import { useEffect, useState } from "react";

// The hero's right half: the product working, not a picture of it.
//
// A replay of a real run of the research and strategy agents — the question, the step
// counts, the answer and the headlines are what the live system produced on 10 Oct 2026
// for a test business, shortened where marked with "…". It is labelled as a replay because
// it is one: a landing page that animates invented results would be making the exact claim
// the product exists to stop making.
//
// It plays once through and holds, then loops. With reduced motion it shows the finished
// state and never moves.

type Step = { who: string; label: string; detail: string; skipped?: boolean };

const QUESTION = "What's trending in quick commerce this week?";
const STEPS: Step[] = [
  { who: "Research", label: "Searching this week's news", detail: "82 articles on “quick commerce” in the last 7 days" },
  { who: "Research", label: "Reading Reddit", detail: "Not connected yet — skipped, not guessed", skipped: true },
  { who: "Research", label: "Checking a competitor's site", detail: "29 posts published in the last 30 days" },
  { who: "Strategy", label: "Deciding what this means for you", detail: "" },
];
const ANSWER = "Quick commerce is gaining visibility as Amazon expands to 300 Indian cities [5] and Gramik builds one of India’s largest rural networks in Uttar Pradesh [4]. Customers will expect fast delivery even in smaller towns…";
const SOURCES = [
  { n: 4, title: "Gramik builds one of India's largest rural quick-commerce networks in UP" },
  { n: 5, title: "Amazon Now quick commerce expands to 300 Indian cities" },
];

// Timeline in ms: when each step starts and finishes, when the answer and sources land.
const T = { stepStart: [400, 1700, 2900, 4100], stepDone: [1400, 2600, 3800, 5600], answer: 5800, sources: 7400, hold: 12500 };

export default function HeroDemo() {
  const [t, setT] = useState(0);
  const [still, setStill] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduce.matches) { setStill(true); return; }
    let start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      let elapsed = now - start;
      if (elapsed > T.hold) { start = now; elapsed = 0; }
      setT(elapsed);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const at = still ? Infinity : t;
  const typed = at >= T.answer ? ANSWER.slice(0, Math.min(ANSWER.length, Math.floor((at - T.answer) / 9))) : "";

  return (
    <figure className="hero-demo" aria-label="A replay of Populr's research and strategy agents answering a market question">
      <div className="hd-bar" aria-hidden="true">
        <span className="hd-dot" /><span className="hd-dot" /><span className="hd-dot" />
        <span className="hd-title">Talk to your AI CMO</span>
      </div>

      <div className="hd-body" aria-hidden="true">
        <p className="hd-q">{QUESTION}</p>

        <ol className="hd-steps">
          {STEPS.map((s, i) => {
            if (at < T.stepStart[i]) return null;
            const done = at >= T.stepDone[i];
            const state = !done ? "running" : s.skipped ? "skipped" : "done";
            return (
              <li key={i} className={"hd-step " + state}>
                <span className="hd-mark" />
                <span className="hd-step-body">
                  <span className="hd-who">{s.who}</span>
                  <span className="hd-label">{s.label}</span>
                  {done && s.detail && <span className="hd-detail">{s.detail}</span>}
                </span>
              </li>
            );
          })}
        </ol>

        {typed && <p className="hd-answer">{typed}{typed.length < ANSWER.length && <span className="hd-caret" />}</p>}

        {at >= T.sources && (
          <ol className="hd-sources">
            {SOURCES.map((s) => (
              <li key={s.n}><span className="hd-n">{s.n}</span>{s.title}</li>
            ))}
          </ol>
        )}
      </div>

      <figcaption className="hd-cap">Replay of a real run · 10 Oct 2026 · test business</figcaption>
      <p className="sr-only">
        Example: asked what is trending in quick commerce, Populr searched this week&apos;s news (82 articles), noted that
        Reddit was not connected rather than guessing, checked a competitor&apos;s site, and answered with numbered sources.
      </p>
    </figure>
  );
}
