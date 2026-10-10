import { safeFetchText } from "@/lib/net/safe-fetch";
import { readSignals } from "@/lib/seo/audit";
import { approvedFixes, buildJsonLd, pagePath, type AutopilotConfig } from "@/lib/seo/autopilot";
import type { AutopilotStore } from "@/lib/seo/autopilot-store";
import { readPage, suggestFix } from "@/lib/seo/autopilot-suggest";

// The tools Populr gives a coding assistant.
//
// The SEO autopilot applies approved fixes with a script, which Google reads and some other
// engines and link previews don't. These tools hand the same approved fixes to the assistant
// editing the site's code, so they land in the HTML as served — visible to everything.
//
// Every tool runs as the workspace the access key belongs to, and only ever reads that
// workspace's settings. Nothing here publishes or changes a live site; the one tool that
// writes (draft_page_fix) saves a draft for the founder to approve in Populr.
//
// Outputs are plain text written for the assistant to act on: what to change, where, and why.

export type ToolDeps = {
  autopilot: AutopilotStore;
  fetchPage?: (url: string) => Promise<string>;
  suggest?: typeof suggestFix;
};

export type ToolResult = { text: string; isError?: boolean };

type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };
  annotations: { readOnlyHint: boolean; destructiveHint: false; idempotentHint: boolean; openWorldHint: boolean };
  run(workspace: string, args: Record<string, unknown>, deps: ToolDeps): Promise<ToolResult>;
};

const NOT_SET_UP = "Populr's SEO autopilot isn't set up for this workspace yet. Set it up at https://www.trypopulr.in/app/keys — it takes a minute — then try again.";

const fetchHtml = async (url: string, deps: ToolDeps) =>
  deps.fetchPage ? deps.fetchPage(url) : (await safeFetchText(url, { timeoutMs: 15_000, maxBytes: 3_000_000 })).text;

const ldTag = (j: unknown) => `<script type="application/ld+json">\n${JSON.stringify(j, null, 2).replace(/</g, "\\u003c")}\n</script>`;

async function config(workspace: string, deps: ToolDeps): Promise<AutopilotConfig | null> {
  return deps.autopilot.get(workspace);
}

const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export const TOOLS: Tool[] = [
  {
    name: "seo_status",
    title: "Populr SEO status",
    description: "Start here. Shows the site Populr manages for this workspace, which page fixes are approved and ready to apply in code, which are waiting for the owner's approval, and whether the business details for structured data are filled in.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(ws, _a, deps) {
      const c = await config(ws, deps);
      if (!c) return { text: NOT_SET_UP };
      const pages = Object.entries(c.pages);
      const approved = pages.filter(([, f]) => f.status === "approved").map(([p]) => p);
      const waiting = pages.filter(([, f]) => f.status === "suggested").map(([p]) => p);
      return {
        text: [
          `Site: ${c.site}`,
          `Business details for structured data: ${c.business ? `filled in (${c.business.type}, "${c.business.name}")` : "not filled in yet"}`,
          `FAQs: ${c.faq.length}`,
          `Pages with approved fixes, ready to apply in code: ${approved.length ? approved.join(", ") : "none"}`,
          `Pages with drafts waiting for the owner's approval in Populr: ${waiting.length ? waiting.join(", ") : "none"}`,
          `Script snippet: ${c.enabled ? (c.seen.count ? `installed, seen on ${c.seen.paths.length} page(s)` : "switched on, not seen on the site yet") : "off"}`,
          "",
          "Next: call get_seo_fixes to get everything approved, with where each change goes.",
        ].join("\n"),
      };
    },
  },
  {
    name: "get_seo_fixes",
    title: "Get approved SEO fixes",
    description: "Returns the SEO changes the site owner has approved in Populr — each page's <title>, meta description and JSON-LD structured data — so you can apply them in the site's source code. Pass a path for one page, or omit it for every page.",
    inputSchema: { type: "object", properties: { path: { type: "string", description: "A page path such as / or /about. Omit for all pages." } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(ws, a, deps) {
      const c = await config(ws, deps);
      if (!c) return { text: NOT_SET_UP };
      const all = approvedFixes(c);
      const only = str(a.path) ? pagePath(str(a.path)) : null;
      const entries = Object.entries(all).filter(([p]) => !only || p === only);
      if (!entries.length) return { text: `No page ${only} is known to Populr for ${c.site}. Call seo_status to see the pages it has fixes for.` };
      const out = [`Approved SEO fixes for ${c.site}. Apply each in the page's <head> (or the framework's metadata API — e.g. Next.js \`export const metadata\`, Nuxt useHead, Astro <head>). Replace existing tags rather than adding duplicates.`, ""];
      for (const [p, f] of entries) {
        out.push(`## ${p}`);
        out.push(f.title ? `<title>${f.title}</title>` : "Title: no approved change.");
        out.push(f.description ? `<meta name="description" content="${f.description.replace(/"/g, "&quot;")}">` : "Description: no approved change.");
        if (f.jsonld.length) { out.push("Structured data:"); for (const j of f.jsonld) out.push(ldTag(j)); }
        out.push("");
      }
      out.push("After deploying, call verify_page with the live URL to confirm each change is in the HTML as served.");
      return { text: out.join("\n") };
    },
  },
  {
    name: "get_structured_data",
    title: "Get JSON-LD structured data",
    description: "Returns schema.org JSON-LD for a page, built only from the business details the owner entered in Populr (name, type, contact, address, hours, profiles; FAQs on the home page). Ready to paste into the page's <head>.",
    inputSchema: { type: "object", properties: { path: { type: "string", description: "Page path, default /" } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(ws, a, deps) {
      const c = await config(ws, deps);
      if (!c) return { text: NOT_SET_UP };
      if (!c.business) return { text: "The business details aren't filled in yet, so there's no structured data to give. Ask the owner to fill them in under Populr → SEO autopilot → Your business." };
      const ld = buildJsonLd(c, pagePath(str(a.path) || "/"));
      return { text: `${ld.map(ldTag).join("\n\n")}\n\nIf the page already has JSON-LD of the same @type, replace it rather than adding a second copy.` };
    },
  },
  {
    name: "audit_page",
    title: "Audit a page's SEO",
    description: "Fetches a live page and checks its on-page SEO: title length, meta description, H1, canonical, viewport, Open Graph and structured data. Returns each problem with why it matters.",
    inputSchema: { type: "object", properties: { url: { type: "string", description: "Full public URL, e.g. https://example.com/about" } }, required: ["url"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async run(_ws, a, deps) {
      const url = str(a.url, 2000);
      if (!/^https?:\/\//i.test(url)) return { text: "Give a full URL starting with https://", isError: true };
      let html: string;
      try { html = await fetchHtml(url, deps); } catch { return { text: `Couldn't fetch ${url}. It has to be a public address.`, isError: true }; }
      const { signals, issues } = readSignals(html);
      return {
        text: [
          `SEO audit of ${url}`,
          "",
          ...signals.map((s) => `${s.verdict === "pass" ? "✓" : s.verdict === "warn" ? "!" : "✗"} ${s.label}: ${s.value}`),
          "",
          issues.length ? "Problems:" : "No problems found.",
          ...issues.map((i) => `- [${i.severity}] ${i.title}. ${i.detail}`),
        ].join("\n"),
      };
    },
  },
  {
    name: "draft_page_fix",
    title: "Draft a title and description",
    description: "Reads one page of the managed site and drafts a better <title> and meta description from what the page actually says. The draft is saved in Populr for the owner to approve; nothing changes on the live site.",
    inputSchema: { type: "object", properties: { path: { type: "string", description: "Page path on the managed site, e.g. /pricing" } }, required: ["path"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async run(ws, a, deps) {
      const c = await config(ws, deps);
      if (!c) return { text: NOT_SET_UP };
      const path = pagePath(str(a.path) || "/");
      const s = await (deps.suggest ?? suggestFix)(c.site, path, c.business?.name || new URL(c.site).hostname, deps.fetchPage ? { fetchPage: deps.fetchPage } : {});
      if (!s.ok) return { text: s.error, isError: true };
      // Never overwrites an approved fix: a draft must not silently replace what the owner signed off.
      if (c.pages[path]?.status === "approved") {
        return { text: `Draft for ${path} (not saved — the page already has an approved fix):\nTitle: ${s.fix.title}\nDescription: ${s.fix.description}` };
      }
      await deps.autopilot.save({ ...c, pages: { ...c.pages, [path]: s.fix } });
      return {
        text: [
          `Drafted for ${c.site}${path}:`,
          `Title (${s.fix.title!.length} chars): ${s.fix.title}`,
          `Description (${s.fix.description!.length} chars): ${s.fix.description}`,
          `Before: title "${s.fix.before?.title ?? "none"}", description "${s.fix.before?.description ?? "none"}"`,
          "",
          "Saved in Populr as waiting for the owner's approval. Once approved, get_seo_fixes returns it.",
        ].join("\n"),
      };
    },
  },
  {
    name: "generate_llms_txt",
    title: "Generate llms.txt",
    description: "Builds an llms.txt for the managed site from the owner's business details and the approved page titles and descriptions — a plain map of the site for AI assistants. Save it at the site root as /llms.txt.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(ws, _a, deps) {
      const c = await config(ws, deps);
      if (!c) return { text: NOT_SET_UP };
      if (!c.business) return { text: "Fill in the business details in Populr first — llms.txt starts with what the business is." };
      const pages = Object.entries(c.pages).filter(([, f]) => f.status === "approved" && f.title);
      const lines = [`# ${c.business.name}`, ""];
      if (c.business.description) lines.push(`> ${c.business.description}`, "");
      if (pages.length) {
        lines.push("## Pages");
        for (const [p, f] of pages) lines.push(`- [${f.title}](${new URL(p, c.site).toString()})${f.description ? `: ${f.description}` : ""}`);
        lines.push("");
      }
      const contact = [c.business.telephone && `Phone: ${c.business.telephone}`, c.business.email && `Email: ${c.business.email}`, c.business.address?.locality && `Location: ${[c.business.address.locality, c.business.address.region, c.business.address.country].filter(Boolean).join(", ")}`].filter(Boolean);
      if (contact.length) lines.push("## Contact", ...contact.map((x) => `- ${x}`), "");
      return { text: `Save this as llms.txt at the root of ${c.site} (in most frameworks: public/llms.txt):\n\n${lines.join("\n")}` };
    },
  },
  {
    name: "verify_page",
    title: "Verify fixes are live",
    description: "Fetches a live page of the managed site and checks that its approved title, description and structured data are present in the HTML as served. Use after deploying.",
    inputSchema: { type: "object", properties: { url: { type: "string", description: "Live URL of a page on the managed site" } }, required: ["url"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async run(ws, a, deps) {
      const c = await config(ws, deps);
      if (!c) return { text: NOT_SET_UP };
      const url = str(a.url, 2000);
      let u: URL;
      try { u = new URL(url); } catch { return { text: "Give a full URL starting with https://", isError: true }; }
      if (u.hostname.replace(/^www\./, "") !== new URL(c.site).hostname.replace(/^www\./, "")) {
        return { text: `${u.hostname} isn't the site Populr manages for this workspace (${c.site}).`, isError: true };
      }
      let html: string;
      try { html = await fetchHtml(u.toString(), deps); } catch { return { text: `Couldn't fetch ${url}.`, isError: true }; }
      const fix = approvedFixes(c)[pagePath(u.pathname)] ?? { jsonld: buildJsonLd(c, pagePath(u.pathname)) };
      const page = readPage(html);
      const types = new Set([...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].flatMap((m) => {
        try { const d = JSON.parse(m[1]); return [d, ...(d["@graph"] ?? [])].map((x: { "@type"?: string }) => x?.["@type"]).filter(Boolean); } catch { return []; }
      }));
      const rows: string[] = [];
      let missing = 0;
      const check = (ok: boolean, label: string) => { rows.push(`${ok ? "✓" : "✗"} ${label}`); if (!ok) missing++; };
      if (fix.title) check(page.title === fix.title, `Title ${page.title === fix.title ? "matches" : `is "${page.title ?? "none"}", approved "${fix.title}"`}`);
      if (fix.description) check(page.description === fix.description, `Description ${page.description === fix.description ? "matches" : "doesn't match the approved one"}`);
      for (const j of fix.jsonld) check(types.has(String(j["@type"])), `Structured data ${j["@type"]} ${types.has(String(j["@type"])) ? "present" : "missing"}`);
      if (!rows.length) return { text: `No approved fixes for ${u.pathname}.` };
      return { text: [`${url}: ${missing ? `${missing} change(s) not in the served HTML yet` : "every approved change is live"}`, ...rows].join("\n") };
    },
  },
];

export function findTool(name: string): Tool | undefined {
  return TOOLS.find((t) => t.name === name);
}
