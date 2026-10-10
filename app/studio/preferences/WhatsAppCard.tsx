"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { workspaceId } from "@/lib/store";

// Connect WhatsApp.
//
// The founder sends a one-time code from their own WhatsApp rather than typing their number
// here. That proves they hold the number without an SMS, and starting the conversation
// from their side is what lets Populr reply freely for the next 24 hours.
//
// While a code is out, this checks every few seconds whether it has been used, so the card
// flips to "Connected" on its own the moment the message lands.

type State =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "linked"; number: string }
  | { kind: "ready"; number: string | null }
  | { kind: "code"; code: string; link: string | null; number: string | null };

export default function WhatsAppCard() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    const d = await fetch(`/api/whatsapp/link?wsid=${encodeURIComponent(workspaceId())}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    if (!d?.ok) return null;
    if (!d.available) return { kind: "unavailable" } as State;
    if (d.linked) return { kind: "linked", number: d.linked } as State;
    return { kind: "ready", number: d.number } as State;
  }, []);

  useEffect(() => {
    refresh().then((s) => setState(s ?? { kind: "unavailable" }));
    return () => { if (poll.current) clearInterval(poll.current); };
  }, [refresh]);

  const connect = async () => {
    setBusy(true);
    try {
      const d = await fetch("/api/whatsapp/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wsid: workspaceId() }) }).then((r) => r.json());
      if (!d?.ok) return;
      setState({ kind: "code", code: d.code, link: d.link, number: state.kind === "ready" ? state.number : null });
      if (poll.current) clearInterval(poll.current);
      const started = Date.now();
      poll.current = setInterval(async () => {
        if (Date.now() - started > 15 * 60_000) { if (poll.current) clearInterval(poll.current); return; }
        const s = await refresh();
        if (s?.kind === "linked") { setState(s); if (poll.current) clearInterval(poll.current); }
      }, 4_000);
    } finally { setBusy(false); }
  };

  const disconnect = async () => {
    setBusy(true);
    await fetch(`/api/whatsapp/link?wsid=${encodeURIComponent(workspaceId())}`, { method: "DELETE" }).catch(() => null);
    setState((await refresh()) ?? { kind: "unavailable" });
    setBusy(false);
  };

  return (
    <section className="prefs-card wa-card" aria-labelledby="wa-h">
      <h2 className="prefs-h2" id="wa-h">WhatsApp</h2>
      <p className="prefs-what">Get your posting plan, approve posts, and ask about your market — by message.</p>

      {state.kind === "loading" && <p className="wa-quiet">Checking…</p>}

      {state.kind === "unavailable" && (
        <p className="wa-quiet">WhatsApp isn&apos;t switched on for Populr yet. This is where you&apos;ll connect it when it is.</p>
      )}

      {state.kind === "linked" && (
        <div className="wa-row">
          <p className="wa-linked">Connected to <b>{state.number}</b></p>
          <button className="wa-secondary" onClick={disconnect} disabled={busy}>Disconnect</button>
        </div>
      )}

      {state.kind === "ready" && (
        <button className="wa-primary" onClick={connect} disabled={busy}>{busy ? "Getting a code…" : "Connect WhatsApp"}</button>
      )}

      {state.kind === "code" && (
        <div className="wa-code">
          <p>Send this from the WhatsApp number you want to use:</p>
          <p className="wa-code-msg"><code>link {state.code}</code></p>
          {state.link && <a className="wa-primary" href={state.link} target="_blank" rel="noopener noreferrer">Open WhatsApp with it typed</a>}
          <p className="wa-quiet">
            {state.number ? <>Or send it to <b>{state.number}</b>. </> : null}
            The code works once, for 15 minutes. This card updates when it&apos;s used.
          </p>
        </div>
      )}

      <ul className="prefs-facts">
        <li>Reply <b>today</b> to see what&apos;s waiting, <b>approve all</b> to let it go out, <b>skip 2</b> to drop one.</li>
        <li>Reply <b>stop</b> any time and Populr won&apos;t message that number again.</li>
      </ul>
    </section>
  );
}
