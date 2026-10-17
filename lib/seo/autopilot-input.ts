import { isSafePublicUrl } from "@/lib/throttle";
import { SCHEMA_TYPES, type BusinessDetails } from "@/lib/seo/autopilot";

// Validation for SEO autopilot settings, shared by the web app's routes and the MCP tools —
// so a site address or business details are accepted or refused the same way in both.

export const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);

/** A public website's origin ("https://yourshop.in"), or null. Accepts a bare domain. */
export function originOf(raw: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return isSafePublicUrl(u.toString()) ? u.origin : null;
  } catch { return null; }
}

export function business(b: unknown): BusinessDetails | null {
  if (!b || typeof b !== "object") return null;
  const x = b as Record<string, unknown>;
  const name = str(x.name, 120)?.trim();
  if (!name) return null;
  const a = (x.address ?? {}) as Record<string, unknown>;
  return {
    type: SCHEMA_TYPES.includes(x.type as never) ? (x.type as BusinessDetails["type"]) : "LocalBusiness",
    name, description: str(x.description, 300), telephone: str(x.telephone, 40), email: str(x.email, 120), logo: str(x.logo, 300),
    address: { street: str(a.street, 200), locality: str(a.locality, 100), region: str(a.region, 100), postalCode: str(a.postalCode, 20), country: str(a.country, 60) },
    openingHours: Array.isArray(x.openingHours) ? x.openingHours.map((h) => str(h, 40)).filter((h): h is string => !!h).slice(0, 7) : undefined,
    sameAs: Array.isArray(x.sameAs) ? x.sameAs.map((h) => str(h, 300)).filter((h): h is string => !!h).slice(0, 8) : undefined,
  };
}

/** An approved title or description, tidied the way the approve route always has. */
export const fixText = (v: unknown, max: number) => str(v, max)?.replace(/\s+/g, " ").trim() || undefined;
