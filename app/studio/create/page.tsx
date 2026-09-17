import type { Metadata } from "next";
import Studio from "./Studio";

// Studio lives inside the existing /studio shell — same StudioNav, same design tokens, same
// grid. A new route rather than a replacement for /studio, so every existing Create surface
// keeps working exactly as it did.

export const metadata: Metadata = {
  title: "Studio",
  description: "Tell Populr what you want to achieve.",
  robots: { index: false, follow: false, nocache: true },
};

export default function StudioCreatePage() {
  return <Studio />;
}
