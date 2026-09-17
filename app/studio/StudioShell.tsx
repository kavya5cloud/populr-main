"use client";

import { usePathname } from "next/navigation";
import StudioNav from "./StudioNav";

// The studio shell, and where the Content Engine's light theme is switched on.
//
// The whole light treatment is a token override — `.studio-light` redefines --bg, --panel,
// --fg and the rest, and every existing rule that already reads those variables follows
// without being rewritten. That is why this is one class rather than a parallel stylesheet:
// a second design system layered over the first is what produced the shadowed-rule bugs in
// the last two passes.
//
// Scoped to the creation surfaces on purpose. Publishing, Team, Intelligence, Results and
// Settings keep the dark treatment they were designed in; converting them is a separate
// decision about the whole product, not a side effect of redesigning Create.
//
// `usePathname` runs during SSR too, so the class is in the first HTML the browser parses
// and there is no flash of the dark theme before hydration.

const LIGHT_ROUTES = new Set(["/studio", "/studio/create"]);

export default function StudioShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const light = LIGHT_ROUTES.has(path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path);

  return (
    <div className={"studio" + (light ? " studio-light" : "")}>
      <StudioNav />
      <main className="st-main">{children}</main>
    </div>
  );
}
