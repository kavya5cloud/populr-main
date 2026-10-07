import { ImageResponse } from "next/og";

// The one social card, parameterised.
//
// Why this exists: Next merges metadata shallowly. A page that sets its own `openGraph`
// replaces the parent's object wholesale — so the image from app/opengraph-image.tsx
// silently vanished from every page that customised its title. That was /guides, every
// guide and /early-access: precisely the pages people share. They unfurled on LinkedIn,
// WhatsApp and X as a bare link while /privacy, which set nothing, kept its image.
//
// A file-based opengraph-image in a segment is attached after that segment's own metadata,
// so it survives. Each such file renders through here, which keeps one design rather than
// four that drift.
//
// System fonts on purpose: the build never depends on fetching a font file.

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

export function ogCard({ eyebrow, title, sub }: { eyebrow?: string; title: string; sub?: string }) {
  // A long guide title at 78px runs off the card. Step down rather than truncate — a
  // half-title in a share preview reads as a bug.
  const titleSize = title.length > 60 ? 54 : title.length > 38 ? 64 : 78;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column",
          justifyContent: "space-between", background: "#080a09",
          padding: "72px 80px", fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 34, color: "#fafafa", letterSpacing: "-0.02em" }}>
          <div style={{ display: "flex" }}>
            Populr<span style={{ color: "#d5ff72" }}>.</span>
          </div>
          {eyebrow && (
            <div style={{ display: "flex", fontSize: 22, color: "#9aa39c", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {eyebrow}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ display: "flex", fontSize: titleSize, color: "#fafafa", letterSpacing: "-0.04em", lineHeight: 1.08, maxWidth: 1020 }}>
            {title}
          </div>
          {sub && (
            <div style={{ display: "flex", fontSize: 28, color: "#9aa39c", maxWidth: 960, lineHeight: 1.38 }}>
              {sub}
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 24, color: "#6f7a72" }}>
          <div style={{ display: "flex", width: 12, height: 12, borderRadius: 12, background: "#d5ff72" }} />
          trypopulr.in
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
