"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { ReactNode } from "react";
import { SHOW_CONTENT_ENGINE } from "@/lib/flags";

// Five places, named after what you want rather than what runs.
//
// This was eight links, and before that seventeen. The count was never the real problem —
// the names were. "Market Intelligence", "Learning Engine" and "Creative Studio" are what
// the subsystems are called in the code, and every one of them made the reader translate
// before they could choose.
//
// Campaigns, the AI team, market intelligence, the learning engine and automation are all
// still here and still running. They are implementation now, not navigation: things Populr
// does, not places you visit. Every route below still resolves, and so do the ones that
// left the list.

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" width="18" height="18" {...stroke} aria-hidden="true">{children}</svg>
);

type Item = { href: string; label: string; icon: ReactNode; match?: (p: string) => boolean };

const NAV: Item[] = [
  {
    // First, and deliberately outside /studio: the whole point is that a founder can read
    // this and stop, without entering the workspace at all.
    href: "/tomorrow", label: "Tomorrow",
    icon: svg(<><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9.5h18" /><path d="M12 13v4M10 15h4" /></>),
  },
  {
    href: "/app", label: "Home",
    icon: svg(<><path d="M4 11l8-6 8 6" /><path d="M6 10v9h12v-9" /></>),
  },
  // Create only appears when there is something behind it. A nav item that redirects to the
  // page you came from is worse than one that isn't there.
  ...(SHOW_CONTENT_ENGINE ? [{
    href: "/studio", label: "Create",
    icon: svg(<><path d="M4 20l1.2-4.2L16.4 4.6a2.05 2.05 0 0 1 2.9 2.9L8.2 18.8 4 20z" /><path d="M14.5 6.5l3 3" /></>),
    // images and motion are absent: both routes redirect to /studio/create, and a nav item
    // that highlights for a page you are bounced off is worse than no nav item.
    match: (p: string) => p === "/studio" || /^\/studio\/(create|documents|ads|videos|ugc|blitz|library)$/.test(p),
  }] : []),
  {
    href: "/studio/social", label: "Publishing",
    icon: svg(<><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9h18M8 2.5v4M16 2.5v4" /></>),
    match: (p) => p === "/studio/social" || p === "/studio/publishing",
  },
  {
    // The nine agents and what they each produced. It had no nav entry at all — reachable
    // only by typing the URL — which is a strange place to leave the thing the product is.
    href: "/studio/launch", label: "Team",
    icon: svg(<><circle cx="9" cy="8" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M16 5.5a3 3 0 0 1 0 5.6" /><path d="M17.5 19a5.5 5.5 0 0 0-2-4.2" /></>),
  },
  {
    href: "/studio/intelligence", label: "Intelligence",
    icon: svg(<><path d="M12 3a6 6 0 0 0-3.6 10.8V17h7.2v-3.2A6 6 0 0 0 12 3z" /><path d="M9.6 20h4.8" /></>),
  },
  {
    href: "/studio/learning", label: "Results",
    icon: svg(<><path d="M4 19V5M4 19h16" /><path d="M8 16l4-6 3 3 5-7" /></>),
    // Opportunities and performance are both "how is it going", so they live together.
    match: (p) => p === "/studio/learning" || p === "/studio/market" || p === "/worked",
  },
  {
    href: "/studio/integrations", label: "Settings",
    icon: svg(<><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.7 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.03z" /></>),
    match: (p) => p === "/studio/integrations" || p === "/studio/jobs" || p === "/account",
  },
];

function NavLink({ item, path }: { item: Item; path: string }) {
  const active = item.match ? item.match(path) : path === item.href;
  return (
    <Link href={item.href} className={"st-link" + (active ? " on" : "")} aria-current={active ? "page" : undefined}>
      <span className="st-link-ic">{item.icon}</span>
      <span className="st-link-label">{item.label}</span>
    </Link>
  );
}

export default function StudioNav() {
  const path = usePathname();
  /**
   * Mobile only.
   *
   * The rail used to become a horizontally scrolling strip below 900px — 731px of links in
   * a 375px viewport, with the scrollbar hidden. Half the product (Team, Intelligence,
   * Results, Settings) was reachable only by guessing that the row scrolled. A menu bar
   * shows where you are and puts everything one tap away instead.
   *
   * Desktop is untouched: the vertical rail is unchanged above 900px, and this state is
   * simply never used there.
   */
  const [open, setOpen] = useState(false);

  // Close on navigation — without this the sheet stays open over the page you just opened.
  useEffect(() => { setOpen(false); }, [path]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const current = NAV.find((i) => (i.match ? i.match(path) : path === i.href));

  return (
    <nav className={"st-nav" + (open ? " open" : "")} aria-label="Populr">
      <Link href="/app" className="st-brand">
        <span className="st-brand-word">Populr<span className="st-brand-acc">.</span></span>
      </Link>

      {/* The mobile bar. Hidden on desktop by CSS, so the markup costs nothing there. */}
      <button
        type="button" className="st-menu-btn" aria-expanded={open} aria-controls="st-links"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="st-menu-where">{current?.label ?? "Menu"}</span>
        <span className="st-menu-ic" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" {...stroke}>
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </span>
        <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
      </button>

      <div className="st-links" id="st-links">
        {NAV.map((i) => <NavLink key={i.href} item={i} path={path} />)}
      </div>
    </nav>
  );
}
