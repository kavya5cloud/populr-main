"use client";

import { useCallback, useEffect, useState } from "react";
import WhatsAppCard from "./WhatsAppCard";
import { loadPreferences, savePreferences } from "@/lib/studio/preferences";
import { DEFAULT_LANGUAGE, LANGUAGE_CODES, localeLabel, type LanguageCode } from "@/lib/i18n/languages";
import {
  DEFAULT_REGION, REGION_CODES, REGIONS, timezoneOf,
  suggestedLanguages, languageMatchesRegion, type RegionCode,
} from "@/lib/i18n/regions";

// Where you sell, and what you sell in.
//
// One page for both because they are one decision made twice. A founder does not separately
// conclude "Maharashtra" and "Marathi" — they know who their customers are, and these are the
// two halves of writing that down.
//
// Each control states what it actually changes, and neither claims more than it does:
//
//   - Language decides what every piece is written in, including the queue's unattended work.
//     That is real and wired end to end.
//   - Location decides the clock scheduling runs against. That is also real: the composer
//     sends the browser's timezone, but the automation queue has no browser and was falling
//     back to UTC, which is five and a half hours wrong for every Indian workspace.
//
// Location does NOT currently change what the copy says. It would be easy to imply otherwise
// and that implication would be false, so the page says which one is which.

type Status = "idle" | "saving" | "saved";

export default function PreferencesPage() {
  const [language, setLanguage] = useState<LanguageCode>(DEFAULT_LANGUAGE);
  const [location, setLocation] = useState<RegionCode>(DEFAULT_REGION);
  const [status, setStatus] = useState<Status>("idle");
  /** Whether a business has actually been analysed. Only changes what the page says. */
  const [analysed, setAnalysed] = useState(true);
  const [ready, setReady] = useState(false);

  // Read through loadState(), which is also what writes — the server first, then
  // localStorage. Reading from a server-only helper would disable both controls in exactly
  // the case where saving works fine.
  useEffect(() => {
    let live = true;
    void loadPreferences().then((p) => {
      if (!live) return;
      setLanguage(p.language);
      setLocation(p.location);
      setAnalysed(p.analysed);
      setReady(true);
    });
    return () => { live = false; };
  }, []);

  const persist = useCallback(async (patch: { language?: LanguageCode; location?: RegionCode }) => {
    setStatus("saving");
    try {
      await savePreferences(patch);
      setStatus("saved");
    } catch {
      setStatus("idle");
    }
  }, []);

  const onLanguage = useCallback((next: LanguageCode) => {
    setLanguage(next);
    void persist({ language: next });
  }, [persist]);

  const onLocation = useCallback((next: RegionCode) => {
    setLocation(next);
    void persist({ location: next });
  }, [persist]);

  const tz = timezoneOf(location);
  const suggestions = suggestedLanguages(location).filter((c) => c !== language);
  // Only worth raising when the region genuinely points somewhere else. English is never
  // "wrong" for a region, so it does not trigger this.
  const mismatched = ready && !languageMatchesRegion(language, location);

  return (
    <section className="st-section prefs">
      <header className="prefs-head">
        <span className="label">Preferences</span>
        <h1 className="prefs-h1">Where you sell, and what you sell in.</h1>
        <p className="prefs-sub">
          Populr uses these for everything it writes and publishes — including the work it
          does on its own, when nobody is watching.
        </p>
      </header>

      {ready && !analysed && (
        <p className="prefs-empty" role="note">
          These are saved and will be used. Populr has not analysed a business yet, though —{" "}
          <a href="/app">add your site</a> and it can write from what it finds rather than
          from the prompt alone.
        </p>
      )}

      <div className="prefs-grid">
        <section className="prefs-card">
          <h2 className="prefs-h2">Language</h2>
          <p className="prefs-what">What every piece is written in.</p>

          <label className="prefs-field">
            <span>Marketing language</span>
            <select
              id="pref-language"
              className="cmp-select"
              value={language}
              disabled={!ready}
              onChange={(e) => onLanguage(e.target.value as LanguageCode)}
            >
              {LANGUAGE_CODES.map((c) => <option key={c} value={c}>{localeLabel(c)}</option>)}
            </select>
          </label>

          <ul className="prefs-facts">
            <li>Written natively in this language, not translated from English afterwards.</li>
            <li>Applies to scheduled and automated posts, using whatever is set when they run.</li>
            <li>Product names, URLs and English technical terms are kept as they are.</li>
          </ul>
        </section>

        <section className="prefs-card">
          <h2 className="prefs-h2">Location</h2>
          <p className="prefs-what">The clock your publishing runs on.</p>

          <label className="prefs-field">
            <span>Where you sell</span>
            <select
              id="pref-location"
              className="cmp-select"
              value={location}
              disabled={!ready}
              onChange={(e) => onLocation(e.target.value as RegionCode)}
            >
              {REGION_CODES.map((c) => <option key={c} value={c}>{REGIONS[c].name}</option>)}
            </select>
          </label>

          <p className="prefs-tz">
            Scheduling uses <b>{tz}</b>. A post set for 9am goes out at 9am there.
          </p>

          {/* Said plainly rather than left to be assumed. A location control on a marketing
              tool reads like it localises the copy, and today it does not. */}
          <ul className="prefs-facts">
            <li>Decides when unattended posts publish. Without it the queue schedules against UTC.</li>
            <li>Does not change what the copy says — that follows the language above.</li>
          </ul>
        </section>
      </div>

      {mismatched && (
        <p className="prefs-nudge" role="note">
          Businesses in {REGIONS[location].name} usually market in{" "}
          {suggestions.map((c, i) => (
            <span key={c}>
              {i > 0 && " or "}
              <button className="prefs-swap" onClick={() => onLanguage(c)}>{localeLabel(c)}</button>
            </span>
          ))}
          . Keep {localeLabel(language)} if that is who you are talking to — this is a
          suggestion, not a correction.
        </p>
      )}

      <div className="prefs-grid wa-grid">
        <WhatsAppCard />
      </div>

      <p className="prefs-status" aria-live="polite">
        {status === "saving" ? "Saving…"
          : status === "saved" ? `Saved. Writing in ${localeLabel(language)}, publishing on ${tz}.`
          : "Changes save as you make them."}
      </p>
    </section>
  );
}
