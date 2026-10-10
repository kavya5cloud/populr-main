"use client";

import { useCallback, useEffect, useState } from "react";
import { workspaceId } from "@/lib/store";

// Answer customers on your WhatsApp Business number.
//
// Connected, off by default. Nothing answers a customer until the founder has written down
// what the agent may say and switched it on — an agent that greets customers with "let me
// check with the team" to every question, because it knows nothing yet, is worse than none.

type Waiting = { ref: number; question: string; from: string; askedAt: number };
type Status =
  | { connected: false }
  | { connected: true; number: string; enabled: boolean; knowledge: string; webhookUrl: string; verifyToken: string; waiting: Waiting[] };

const wsid = () => encodeURIComponent(workspaceId());

export default function BusinessWhatsAppCard() {
  const [s, setS] = useState<Status | null>(null);
  const [form, setForm] = useState({ phoneNumberId: "", token: "", appSecret: "" });
  const [knowledge, setKnowledge] = useState("");
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const d = await fetch(`/api/whatsapp/business?wsid=${wsid()}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    if (!d?.ok) return;
    setS(d.connected ? d : { connected: false });
    if (d.connected) setKnowledge(d.knowledge);
  }, []);
  useEffect(() => { load(); }, [load]);

  const call = async (method: string, body?: object) => {
    setBusy(true); setNote(null);
    try {
      const r = await fetch(method === "DELETE" ? `/api/whatsapp/business?wsid=${wsid()}` : "/api/whatsapp/business", {
        method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify({ wsid: workspaceId(), ...body }) : undefined,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setNote(d.detail || "That didn't work. Check the details and try again.");
      else if (d.message) setNote(d.message);
      await load();
      return r.ok;
    } finally { setBusy(false); }
  };

  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => setNote("Copied."));

  return (
    <section className="prefs-card wa-card wab-card" aria-labelledby="wab-h">
      <h2 className="prefs-h2" id="wab-h">Answer customers on WhatsApp</h2>
      <p className="prefs-what">
        Connect your WhatsApp Business number and Populr answers customers from what you&apos;ve told it.
        Anything it doesn&apos;t know, it asks you — and remembers your answer for next time.
      </p>

      {!s && <p className="wa-quiet">Checking…</p>}

      {s && !s.connected && (
        <form className="wab-form" onSubmit={(e) => { e.preventDefault(); call("POST", form).then((ok) => ok && setForm({ phoneNumberId: "", token: "", appSecret: "" })); }}>
          <ol className="wab-steps">
            <li>In Meta&apos;s developer dashboard, open your app → WhatsApp → API setup.</li>
            <li>Copy the <b>Phone number ID</b>, a permanent <b>access token</b> (from a System User), and the <b>App secret</b> (App settings → Basic).</li>
          </ol>
          <label className="prefs-field">Phone number ID
            <input inputMode="numeric" autoComplete="off" value={form.phoneNumberId} onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value })} />
          </label>
          <label className="prefs-field">Access token
            <input type="password" autoComplete="off" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} />
          </label>
          <label className="prefs-field">App secret
            <input type="password" autoComplete="off" value={form.appSecret} onChange={(e) => setForm({ ...form, appSecret: e.target.value })} />
          </label>
          <button className="wa-primary" disabled={busy || !form.phoneNumberId || !form.token || !form.appSecret}>{busy ? "Checking with Meta…" : "Connect"}</button>
          <p className="wa-quiet">We check these with Meta before saving. The token and secret are encrypted and never shown again.</p>
        </form>
      )}

      {s?.connected && (
        <>
          <div className="wa-row">
            <p className="wa-linked">Connected to <b>{s.number}</b></p>
            <label className="wab-switch">
              <input type="checkbox" checked={s.enabled} disabled={busy || (!s.enabled && !knowledge.trim())} onChange={(e) => call("PATCH", { enabled: e.target.checked })} />
              <span>{s.enabled ? "Answering customers" : "Off"}</span>
            </label>
          </div>
          {!s.enabled && !knowledge.trim() && <p className="wa-quiet">Write what it can tell customers below before switching it on.</p>}

          <details className="wab-setup">
            <summary>Webhook details for Meta</summary>
            <p className="wa-quiet">In your app → WhatsApp → Configuration, set these and subscribe to <b>messages</b>.</p>
            <div className="wab-copy"><span>Callback URL</span><code>{s.webhookUrl}</code><button type="button" onClick={() => copy(s.webhookUrl)}>Copy</button></div>
            <div className="wab-copy"><span>Verify token</span><code>{s.verifyToken}</code><button type="button" onClick={() => copy(s.verifyToken)}>Copy</button></div>
          </details>

          <label className="prefs-field wab-know">What it can tell customers
            <textarea rows={7} value={knowledge} maxLength={8000} onChange={(e) => setKnowledge(e.target.value)}
              placeholder={"Open 9am–9pm, every day except Tuesday.\nWe deliver within 3 km of Kothrud, free above ₹499.\nPayment: UPI, cards, cash on delivery.\nReturns within 7 days with the bill."} />
          </label>
          <div className="wa-row">
            <p className="wa-quiet">Prices, timings and policies it only states if they&apos;re written here.</p>
            <button className="wa-secondary" disabled={busy || knowledge === s.knowledge} onClick={() => call("PATCH", { knowledge })}>Save</button>
          </div>

          {s.waiting.length > 0 && (
            <div className="wab-waiting">
              <h3>Customers waiting on you</h3>
              {s.waiting.map((w) => (
                <div key={w.ref} className="wab-q">
                  <p><b>#{w.ref}</b> · {w.from}</p>
                  <p className="wab-q-text">&ldquo;{w.question}&rdquo;</p>
                  <div className="wab-answer">
                    <input placeholder="Your answer" value={answers[w.ref] ?? ""} onChange={(e) => setAnswers({ ...answers, [w.ref]: e.target.value })} />
                    <button className="wa-primary" disabled={busy || !(answers[w.ref] ?? "").trim()} onClick={() => call("PATCH", { answer: { ref: w.ref, text: answers[w.ref] } }).then(() => setAnswers({ ...answers, [w.ref]: "" }))}>Send</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <button className="wa-secondary wab-disconnect" disabled={busy} onClick={() => confirm("Disconnect your WhatsApp Business number? Populr will stop answering customers.") && call("DELETE")}>Disconnect</button>
        </>
      )}

      {note && <p className="wab-note" role="status">{note}</p>}
    </section>
  );
}
