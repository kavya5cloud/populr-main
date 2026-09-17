"use client";

import { useEffect, useRef } from "react";

// Visibility-aware polling.
//
// Every polling screen in the studio used to hold an unconditional timer: `/studio/jobs`
// re-armed a 1s `setTimeout` forever, and `/studio/social` and `/studio/integrations` each
// ran a 3s `setInterval` that fired three fetches. None of them checked whether anyone was
// looking, so a tab left open in the background generated 3,600 requests an hour, each one
// a function invocation billed as Active CPU. One person with three studio tabs open was
// producing roughly a quarter of a million requests a day against an app with one visitor.
//
// This is the pattern `app/studio/launch/Workspace.tsx` already used correctly, extracted so
// there is one implementation rather than four — the repo's most common historical mistake
// is building a second copy of something that already exists.
//
// Two rules it enforces that the hand-rolled versions did not:
//   - a hidden tab polls nothing, and refreshes once on return
//   - the timer is always cleared on unmount, so a remount cannot leave a loop running

export function usePoll(fn: () => void | Promise<void>, intervalMs: number, enabled = true) {
  // Held in a ref so a caller redefining `fn` each render does not restart the timer —
  // which is how a poll loop accidentally becomes several poll loops.
  const saved = useRef(fn);
  useEffect(() => { saved.current = fn; }, [fn]);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;

    const run = () => { if (!stopped) void saved.current(); };
    const start = () => { if (!timer) timer = setInterval(run, intervalMs); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };

    const onVisibility = () => {
      if (document.hidden) { stop(); return; }
      run();      // catch up once on return, then resume
      start();
    };

    run();
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopped = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, enabled]);
}
