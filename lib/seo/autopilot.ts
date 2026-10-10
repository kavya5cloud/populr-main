// SEO autopilot: one line on the customer's site, and Populr applies the fixes itself.
//
// Most small businesses can't act on an SEO report — they can't edit their site's code, and
// a list of problems they can't fix is just a list. So the customer pastes one script tag,
// once, and Populr applies what the founder has approved:
//
//   - Structured data (schema.org JSON-LD) describing the business — name, what it does,
//     phone, address, social profiles, FAQs. Google documents that it reads JSON-LD added by
//     JavaScript, so this is the dependable part.
//   - A better title and description per page, drafted from what's actually on the page.
//     Google reads titles and descriptions set by script; some other engines and link
//     previews read only the HTML as served. The settings screen says so.
//
// Nothing here is invented. Structured data is built only from details the founder typed;
// titles and descriptions apply only after the founder approved them. A fix nobody signed
// off does not reach anyone's site.

export const SCHEMA_TYPES = ["LocalBusiness", "Store", "Restaurant", "ProfessionalService", "Organization"] as const;
export type SchemaType = (typeof SCHEMA_TYPES)[number];

export type BusinessDetails = {
  type: SchemaType;
  name: string;
  description?: string;
  telephone?: string;
  email?: string;
  logo?: string;
  address?: { street?: string; locality?: string; region?: string; postalCode?: string; country?: string };
  /** schema.org openingHours strings, e.g. "Mo-Sa 09:00-21:00". */
  openingHours?: string[];
  /** Profiles elsewhere — Instagram, LinkedIn, Google Maps. They tie the entity together. */
  sameAs?: string[];
};

export type PageFix = {
  title?: string;
  description?: string;
  status: "suggested" | "approved";
  /** What the page had when the suggestion was made, so the founder sees before and after. */
  before?: { title: string | null; description: string | null };
  at: number;
};

export type AutopilotConfig = {
  workspace: string;
  /** Public id in the snippet URL. Not a secret — it only selects which approved fixes to serve. */
  siteKey: string;
  /** Origin the snippet is allowed to run on, e.g. https://kiranaexpress.in */
  site: string;
  enabled: boolean;
  business: BusinessDetails | null;
  faq: { q: string; a: string }[];
  pages: Record<string, PageFix>;
  seen: { count: number; lastAt: number | null; lastPath: string | null; paths: string[] };
};

const httpsUrl = (u: string | undefined): string | undefined => {
  if (!u) return undefined;
  try { const x = new URL(u.trim()); return x.protocol === "https:" || x.protocol === "http:" ? x.toString() : undefined; } catch { return undefined; }
};
const clean = (s: string | undefined, max: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : undefined;
};

/** Normalise a path so "/About/", "/about" and "/about?x=1" are one page. */
export function pagePath(p: string): string {
  let path = (p || "/").split(/[?#]/)[0].toLowerCase();
  if (!path.startsWith("/")) path = "/" + path;
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return path || "/";
}

/**
 * The site-wide structured data. Built only from what the founder typed — every field is
 * optional except the name, and an empty field is left out rather than filled with a guess.
 */
export function buildJsonLd(cfg: Pick<AutopilotConfig, "site" | "business" | "faq">, path: string): Record<string, unknown>[] {
  const b = cfg.business;
  if (!b?.name?.trim()) return [];
  const out: Record<string, unknown>[] = [];

  const addr = b.address && Object.values(b.address).some(Boolean)
    ? Object.fromEntries(Object.entries({
        "@type": "PostalAddress",
        streetAddress: clean(b.address.street, 200), addressLocality: clean(b.address.locality, 100),
        addressRegion: clean(b.address.region, 100), postalCode: clean(b.address.postalCode, 20),
        addressCountry: clean(b.address.country, 60),
      }).filter(([, v]) => v))
    : undefined;

  const entity: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": SCHEMA_TYPES.includes(b.type) ? b.type : "Organization",
    "@id": `${cfg.site}/#business`,
    name: clean(b.name, 120),
    url: cfg.site,
    description: clean(b.description, 300),
    telephone: clean(b.telephone, 40),
    email: clean(b.email, 120),
    logo: httpsUrl(b.logo),
    address: addr,
    openingHours: b.openingHours?.map((h) => clean(h, 40)).filter(Boolean),
    sameAs: b.sameAs?.map(httpsUrl).filter(Boolean),
  };
  out.push(Object.fromEntries(Object.entries(entity).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length))));

  out.push({ "@context": "https://schema.org", "@type": "WebSite", "@id": `${cfg.site}/#website`, url: cfg.site, name: clean(b.name, 120), publisher: { "@id": `${cfg.site}/#business` } });

  // FAQs belong on one page. Marking the same questions up on every page is duplicate
  // markup, which Google treats as spam rather than as emphasis.
  const faq = cfg.faq.filter((f) => f.q.trim() && f.a.trim()).slice(0, 10);
  if (path === "/" && faq.length) {
    out.push({
      "@context": "https://schema.org", "@type": "FAQPage",
      mainEntity: faq.map((f) => ({ "@type": "Question", name: clean(f.q, 200), acceptedAnswer: { "@type": "Answer", text: clean(f.a, 1000) } })),
    });
  }
  return out;
}

/** What the snippet applies on each page: approved fixes only. */
export function approvedFixes(cfg: AutopilotConfig): Record<string, { title?: string; description?: string; jsonld: Record<string, unknown>[] }> {
  const paths = new Set(["/", ...Object.keys(cfg.pages)]);
  const out: Record<string, { title?: string; description?: string; jsonld: Record<string, unknown>[] }> = {};
  for (const p of paths) {
    const fix = cfg.pages[p];
    const approved = fix?.status === "approved";
    out[p] = {
      ...(approved && fix.title ? { title: fix.title } : {}),
      ...(approved && fix.description ? { description: fix.description } : {}),
      jsonld: buildJsonLd(cfg, p),
    };
  }
  return out;
}

/**
 * JSON safe to embed in a JavaScript file. "<" is escaped so "</script>" inside a business
 * description can't end the script if the file is ever inlined, and U+2028/2029 are escaped
 * because they end a line in older JavaScript parsers.
 */
const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
export function jsonForJs(v: unknown): string {
  return JSON.stringify(v).replace(/</g, "\\u003c").split(LS).join("\\u2028").split(PS).join("\\u2029");
}

/**
 * The script a customer's site loads. Small, dependency-free, and inert anywhere but the
 * registered domain. It adds structured data only for types the page doesn't already
 * declare — a site that already marks itself up is not given a second, conflicting copy.
 */
export function renderSnippet(cfg: AutopilotConfig, origin: string): string {
  if (!cfg.enabled) return "/* Populr SEO autopilot is switched off for this site. */";
  const host = new URL(cfg.site).hostname.replace(/^www\./, "");
  const fixes = approvedFixes(cfg);
  return `/* Populr SEO autopilot — ${host}. Applies fixes the site owner approved in Populr. */
(function(){try{
var H=${jsonForJs(host)},F=${jsonForJs(fixes)},K=${jsonForJs(cfg.siteKey)},O=${jsonForJs(origin)};
if(location.hostname.replace(/^www\\./,"")!==H)return;
var p=(location.pathname||"/").toLowerCase().replace(/\\/+$/,"")||"/";
var f=F[p]||{jsonld:F["/"]?F["/"].jsonld.filter(function(j){return j["@type"]!=="FAQPage"}):[]};
var have={};document.querySelectorAll('script[type="application/ld+json"]').forEach(function(s){try{var d=JSON.parse(s.textContent||"");[].concat(d["@graph"]||d).forEach(function(x){if(x&&x["@type"])have[x["@type"]]=1})}catch(e){}});
(f.jsonld||[]).forEach(function(j){if(have[j["@type"]])return;var s=document.createElement("script");s.type="application/ld+json";s.setAttribute("data-populr","");s.text=JSON.stringify(j);document.head.appendChild(s)});
if(f.title)document.title=f.title;
if(f.description){var m=document.querySelector('meta[name="description"]');if(!m){m=document.createElement("meta");m.name="description";document.head.appendChild(m)}m.content=f.description}
new Image().src=O+"/api/seo/autopilot/seen?k="+encodeURIComponent(K)+"&p="+encodeURIComponent(p);
}catch(e){}})();`;
}

/** The tag the customer pastes. */
export function snippetTag(siteKey: string, origin: string): string {
  return `<script src="${origin}/s/${siteKey}.js" async></script>`;
}
