import { ImageResponse } from "next/og";
import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og-card";
import { DOMAIN_RE } from "@/lib/check/checks";
import { checkStore } from "@/lib/check/store";

// The card that shows when a result is shared: the domain, the score, and the grade.

export const alt = "SEO & AI readiness score — Populr";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

const RING = 2 * Math.PI * 164;

export default async function Image({ params }: { params: Promise<{ domain: string }> }) {
  const domain = decodeURIComponent((await params).domain).toLowerCase();
  const result = DOMAIN_RE.test(domain) ? await checkStore().get(domain).catch(() => null) : null;
  const score = result?.score ?? null;
  const tone = score === null ? "#9aa39c" : score >= 75 ? "#d5ff72" : score >= 50 ? "#ffd166" : "#ff8a6b";
  const pct = score ?? 0;
  const nameSize = domain.length > 26 ? 52 : domain.length > 18 ? 64 : 76;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#080a09", padding: "64px 72px", fontFamily: "system-ui, sans-serif", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: "100%", maxWidth: 640 }}>
          <div style={{ display: "flex", fontSize: 32, color: "#fafafa", letterSpacing: "-0.02em" }}>
            Populr<span style={{ color: "#d5ff72" }}>.</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ display: "flex", fontSize: 24, color: "#9aa39c", letterSpacing: "0.08em", textTransform: "uppercase" }}>SEO & AI readiness</div>
            <div style={{ display: "flex", fontSize: nameSize, color: "#fafafa", letterSpacing: "-0.04em", lineHeight: 1.05 }}>{domain}</div>
            <div style={{ display: "flex", fontSize: 28, color: "#9aa39c" }}>
              {result ? `${result.passed} of ${result.total} checks passed · grade ${result.grade}` : "Not checked yet"}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 24, color: "#6f7a72" }}>
            <div style={{ display: "flex", width: 12, height: 12, borderRadius: 12, background: "#d5ff72" }} />
            Check yours free · trypopulr.in/check
          </div>
        </div>
        <div style={{ display: "flex", position: "relative", width: 380, height: 380 }}>
          <svg width="380" height="380" viewBox="0 0 380 380" style={{ position: "absolute", top: 0, left: 0 }}>
            <circle cx="190" cy="190" r="164" stroke="#1b1f1c" strokeWidth="30" fill="none" />
            {pct > 0 && <circle cx="190" cy="190" r="164" stroke={tone} strokeWidth="30" fill="none" strokeLinecap="round" strokeDasharray={`${(RING * pct) / 100} ${RING}`} transform="rotate(-90 190 190)" />}
          </svg>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: 380, height: 380 }}>
            <div style={{ display: "flex", fontSize: 150, color: "#fafafa", letterSpacing: "-0.06em", lineHeight: 1 }}>{score ?? "?"}</div>
            <div style={{ display: "flex", fontSize: 30, color: "#9aa39c" }}>out of 100</div>
          </div>
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
