// Where to send someone after they sign in.
//
// Only a path on this site is accepted — "/app/keys", not "https://elsewhere" or "//elsewhere"
// — so a sign-in link can't be turned into a redirect to another site. Anything else falls
// back to the dashboard. Long enough for an OAuth authorization request's query string.

export const DEFAULT_NEXT = "/app";

export function safeNext(raw: string | null | undefined): string {
  const v = String(raw ?? "").trim();
  if (!v.startsWith("/") || v.startsWith("//") || v.includes("\\") || /[\u0000-\u001f]/.test(v) || v.length > 2000) return DEFAULT_NEXT;
  try {
    const u = new URL(v, "https://populr.invalid");
    if (u.origin !== "https://populr.invalid") return DEFAULT_NEXT;
    return u.pathname + u.search;
  } catch {
    return DEFAULT_NEXT;
  }
}

/** The page to land on after a successful sign-in, with ?auth=ok so it can say so. */
export function signedInUrl(origin: string, next: string): string {
  const u = new URL(next, origin);
  u.searchParams.set("auth", "ok");
  return u.toString();
}
