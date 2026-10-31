import { readHtml } from "@/lib/check/checks";
import { safeFetchPrefix, safeFetchText } from "@/lib/net/safe-fetch";
import { imageSize, type ImageSize } from "./image-size";

// The link preview checker: what WhatsApp, LinkedIn, X and Slack show when someone shares a
// page — read from the same tags they read (Open Graph, then Twitter's, then the plain
// <title> and description), with the share image fetched far enough to know it loads and
// how big it is.
//
// The advice is what the platforms document or what's widely observed, and says which: the
// sizes are their published recommendations; WhatsApp's image-size limit isn't published,
// so it's stated as what it is — an observation.

export type PreviewMeta = {
  url: string;
  title: string | null;
  description: string | null;
  siteName: string | null;
  image: string | null;
  imageAlt: string | null;
  twitterCard: string | null;
  favicon: string | null;
  ogTitle: boolean;
  ogDescription: boolean;
};

export type ImageInfo = { url: string; status: number; type: string; bytes: number | null; size: ImageSize | null; error?: string };
export type PreviewCheck = { id: string; level: "good" | "warn" | "bad"; label: string; detail: string };

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;|&apos;/g, "'").replace(/\s+/g, " ").trim();
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) out[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? "";
  return out;
}

export function readPreviewMeta(html: string, pageUrl: string): PreviewMeta {
  const head = html.slice(0, 500_000);
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => attrs(m[0]));
  const meta = (...keys: string[]) => {
    for (const k of keys) {
      const t = metas.find((m) => (m.property ?? m.name ?? "").toLowerCase() === k);
      if (t?.content?.trim()) return decode(t.content);
    }
    return null;
  };
  const abs = (u: string | null) => { if (!u) return null; try { return new URL(u, pageUrl).toString(); } catch { return null; } };
  const icon = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => attrs(m[0])).find((l) => /(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/i.test(l.rel ?? ""))?.href ?? "/favicon.ico";
  const plain = readHtml(head);
  return {
    url: pageUrl,
    title: meta("og:title", "twitter:title") ?? plain.title,
    description: meta("og:description", "twitter:description") ?? plain.description,
    siteName: meta("og:site_name"),
    image: abs(meta("og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src")),
    imageAlt: meta("og:image:alt", "twitter:image:alt"),
    twitterCard: meta("twitter:card"),
    favicon: abs(icon),
    ogTitle: !!meta("og:title"),
    ogDescription: !!meta("og:description"),
  };
}

export function previewChecks(m: PreviewMeta, img: ImageInfo | null): PreviewCheck[] {
  const out: PreviewCheck[] = [];
  const add = (id: string, level: PreviewCheck["level"], label: string, detail: string) => out.push({ id, level, label, detail });

  if (!m.title) add("title", "bad", "Title", "No og:title and no <title>: apps show the bare link.");
  else if (!m.ogTitle) add("title", "warn", "Title", `No og:title, so apps fall back to the page's <title> ("${m.title}"). Set og:title to control what's shown.`);
  else if (m.title.length > 70) add("title", "warn", "Title", `${m.title.length} characters — LinkedIn and WhatsApp cut long titles. Aim for under 70.`);
  else add("title", "good", "Title", `"${m.title}"`);

  if (!m.description) add("description", "warn", "Description", "No description: most apps show only the title.");
  else if (!m.ogDescription) add("description", "warn", "Description", "No og:description, so apps fall back to the meta description. Set og:description to control it.");
  else if (m.description.length > 200) add("description", "warn", "Description", `${m.description.length} characters — apps show about two lines. Aim for under 160.`);
  else add("description", "good", "Description", `${m.description.length} characters.`);

  if (!m.image) add("image", "bad", "Share image", "No og:image: WhatsApp, LinkedIn and X show a plain text link, which gets far fewer clicks.");
  else if (!img || img.error || img.status !== 200) add("image", "bad", "Share image", `The og:image ${img?.error ? `couldn't be loaded (${img.error})` : `answered ${img?.status}`} — apps will show no picture.`);
  else if (!img.type.startsWith("image/")) add("image", "bad", "Share image", `The og:image is served as ${img.type || "unknown type"}, not an image.`);
  else if (/svg/i.test(img.type)) add("image", "bad", "Share image", "SVG share images aren't supported by Facebook, LinkedIn or X. Use a PNG or JPG.");
  else {
    const s = img.size;
    if (s && (s.width < 600 || s.height < 315)) add("image", "warn", "Share image", `${s.width}×${s.height}px — small images show as a little thumbnail. 1200×630 works everywhere.`);
    else if (s && Math.abs(s.width / s.height - 1.91) > 0.25) add("image", "warn", "Share image", `${s.width}×${s.height}px — apps crop to about 1.91:1, so the edges will be cut. 1200×630 works everywhere.`);
    else add("image", "good", "Share image", s ? `${s.width}×${s.height}px ${s.format.toUpperCase()}.` : "Loads as an image.");
    if (img.bytes && img.bytes > 300_000) add("image-weight", "warn", "Image file size", `${Math.round(img.bytes / 1000)} KB — WhatsApp is widely observed to skip preview images over about 300 KB. Compress it.`);
  }
  if (m.image && !/^https:/.test(m.image)) add("image-https", "warn", "Image address", "The og:image isn't on https — some apps refuse it.");

  if (!m.twitterCard) add("twitter", "warn", "X card", "No twitter:card: X shows a small card. Set it to summary_large_image for the big one.");
  else add("twitter", "good", "X card", `twitter:card is ${m.twitterCard}.`);
  if (!m.siteName) add("site-name", "warn", "Site name", "No og:site_name: Slack, Discord and Facebook show the bare domain instead of your name.");
  else add("site-name", "good", "Site name", m.siteName);
  return out;
}

export class PreviewFetchError extends Error {}

export async function checkLinkPreview(pageUrl: string): Promise<{ meta: PreviewMeta; image: ImageInfo | null; checks: PreviewCheck[] }> {
  let page: { url: string; status: number; text: string };
  try {
    page = await safeFetchText(pageUrl, { timeoutMs: 10_000, maxBytes: 3_000_000, headers: { "User-Agent": "Mozilla/5.0 (compatible; PopulrPreview/1.0; +https://www.trypopulr.in/tools/link-preview-checker)" } });
  } catch {
    throw new PreviewFetchError("Couldn't load that page. Check the address — it has to be public.");
  }
  if (page.status >= 400) throw new PreviewFetchError(`That page answered ${page.status}.`);
  const meta = readPreviewMeta(page.text, page.url);
  let image: ImageInfo | null = null;
  if (meta.image) {
    try {
      const r = await safeFetchPrefix(meta.image, { timeoutMs: 8_000, prefixBytes: 256_000 });
      image = { url: meta.image, status: r.status, type: r.type, bytes: r.size, size: imageSize(r.bytes) };
    } catch (e) {
      image = { url: meta.image, status: 0, type: "", bytes: null, size: null, error: e instanceof Error && /private|public|unsafe/i.test(e.message) ? "not a public address" : "it didn't load" };
    }
  }
  return { meta, image, checks: previewChecks(meta, image) };
}
