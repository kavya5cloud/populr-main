import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isSafePublicUrl, rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { url as siteUrl } from "@/lib/seo";
import { pagePath, SCHEMA_TYPES, snippetTag, type AutopilotConfig, type BusinessDetails } from "@/lib/seo/autopilot";
import { autopilotStore } from "@/lib/seo/autopilot-store";
import { suggestFix } from "@/lib/seo/autopilot-suggest";

export const runtime = "nodejs";
export const maxDuration = 60;

// The SEO autopilot's settings, for the dashboard.
//
//   GET     the config, the tag to paste, and whether the snippet has been seen running
//   PUT     site, on/off, business details, FAQs
//   POST    { path } — draft a title and description for a page (saved as "suggested")
//   PATCH   { path, title, description } — approve a page's fix, edited or as drafted
//   DELETE  ?path= — drop a page's fix

const ORIGIN = siteUrl("/").replace(/\/$/, "");

async function ws(req: NextRequest, wsid: string | null): Promise<{ error: NextResponse } | { w: string }> {
  const session = await getSession();
  const limit = rateLimit(`autopilot:${requestKey(req.headers, session?.userId)}`, session ? 40 : 15, 60_000);
  if (!limit.allowed) return { error: NextResponse.json({ error: "rate_limited" }, { status: 429 }) };
  const w = await workspaceKey(wsid);
  return w ? { w } : { error: NextResponse.json({ error: "no_key" }, { status: 400 }) };
}

function view(c: AutopilotConfig | null) {
  if (!c) return { ok: true, configured: false };
  return { ok: true, configured: true, ...c, tag: snippetTag(c.siteKey, ORIGIN) };
}

function originOf(raw: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return isSafePublicUrl(u.toString()) ? u.origin : null;
  } catch { return null; }
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);

function business(b: unknown): BusinessDetails | null {
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

export async function GET(req: NextRequest) {
  const r = await ws(req, req.nextUrl.searchParams.get("wsid"));
  if ("error" in r) return r.error;
  return NextResponse.json(view(await autopilotStore().get(r.w)));
}

export async function PUT(req: NextRequest) {
  const b = await req.json().catch(() => ({})) as Record<string, unknown>;
  const r = await ws(req, str(b.wsid, 100) ?? null);
  if ("error" in r) return r.error;
  const store = autopilotStore();
  const prev = await store.get(r.w);
  const site = b.site !== undefined ? originOf(String(b.site)) : prev?.site;
  if (!site) return NextResponse.json({ error: "bad_site", detail: "Use your website's public address, like yourshop.in." }, { status: 400 });

  const faq = Array.isArray(b.faq)
    ? b.faq.map((f) => ({ q: str((f as Record<string, unknown>)?.q, 200)?.trim() ?? "", a: str((f as Record<string, unknown>)?.a, 1000)?.trim() ?? "" })).filter((f) => f.q && f.a).slice(0, 10)
    : prev?.faq ?? [];
  const next = await store.save({
    workspace: r.w, siteKey: prev?.siteKey, site,
    enabled: typeof b.enabled === "boolean" ? b.enabled : prev?.enabled ?? false,
    business: b.business !== undefined ? business(b.business) : prev?.business ?? null,
    faq,
    // A different site invalidates every page fix: they were drafted from another domain.
    pages: prev && prev.site === site ? prev.pages : {},
  });
  return NextResponse.json(view(next));
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({})) as { wsid?: string; path?: string };
  const r = await ws(req, b.wsid ?? null);
  if ("error" in r) return r.error;
  const store = autopilotStore();
  const c = await store.get(r.w);
  if (!c) return NextResponse.json({ error: "not_configured" }, { status: 404 });
  const path = pagePath(String(b.path ?? "/"));
  if (Object.keys(c.pages).length >= 50 && !c.pages[path]) return NextResponse.json({ error: "too_many_pages" }, { status: 400 });

  const s = await suggestFix(c.site, path, c.business?.name || new URL(c.site).hostname);
  if (!s.ok) return NextResponse.json({ error: "suggest_failed", detail: s.error }, { status: 422 });
  return NextResponse.json(view(await store.save({ ...c, pages: { ...c.pages, [path]: s.fix } })));
}

export async function PATCH(req: NextRequest) {
  const b = await req.json().catch(() => ({})) as { wsid?: string; path?: string; title?: string; description?: string };
  const r = await ws(req, b.wsid ?? null);
  if ("error" in r) return r.error;
  const store = autopilotStore();
  const c = await store.get(r.w);
  if (!c) return NextResponse.json({ error: "not_configured" }, { status: 404 });
  const path = pagePath(String(b.path ?? "/"));
  const title = str(b.title, 70)?.replace(/\s+/g, " ").trim();
  const description = str(b.description, 170)?.replace(/\s+/g, " ").trim();
  if (!title && !description) return NextResponse.json({ error: "empty" }, { status: 400 });
  const prev = c.pages[path];
  return NextResponse.json(view(await store.save({ ...c, pages: { ...c.pages, [path]: { title, description, status: "approved", before: prev?.before, at: Date.now() } } })));
}

export async function DELETE(req: NextRequest) {
  const r = await ws(req, req.nextUrl.searchParams.get("wsid"));
  if ("error" in r) return r.error;
  const store = autopilotStore();
  const c = await store.get(r.w);
  if (!c) return NextResponse.json(view(null));
  const path = pagePath(req.nextUrl.searchParams.get("path") ?? "/");
  const pages = { ...c.pages };
  delete pages[path];
  return NextResponse.json(view(await store.save({ ...c, pages })));
}
