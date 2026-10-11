"use client";

import { useEffect, useState } from "react";
import { loadLocal, loadState } from "@/lib/store";

// "← Back to dashboard" — when there is a dashboard to go back to.
//
// With no website analysed yet, /app is the "What are we growing?" start screen, so a link
// promising the dashboard landed somewhere that looks like the home page. Then the link says
// what it does and goes to Populr's home page instead. A workspace counts whether it's in this
// browser or saved to the account.

export default function BackLink() {
  const [dashboard, setDashboard] = useState<boolean | null>(null);

  useEffect(() => {
    if (loadLocal()?.profile) { setDashboard(true); return; }
    let live = true;
    loadState()
      .then(({ saved }) => { if (live) setDashboard(!!saved?.profile); })
      .catch(() => { if (live) setDashboard(false); });
    return () => { live = false; };
  }, []);

  if (dashboard === false) return <a href="/">← Populr home</a>;
  return <a href="/app">{dashboard ? "← Back to dashboard" : "← Back"}</a>;
}
