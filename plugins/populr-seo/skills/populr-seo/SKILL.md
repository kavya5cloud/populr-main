---
name: populr-seo
description: Apply SEO fixes approved in Populr to a website's code — page titles, meta descriptions, JSON-LD structured data and llms.txt — and verify them on the live site. Use when the user asks to apply, sync or check their Populr SEO fixes, add structured data, create llms.txt, or audit a page's SEO.
---

# Populr SEO

Populr manages SEO for the user's website. The site owner approves changes in Populr; you apply them in the site's code, where every search engine, AI crawler and link preview reads them. Populr's MCP tools (server `populr`) give you exactly what's approved.

## First time: set up from the editor

If `seo_status` says no site is set up, you can do it all here — ask the user before each step that saves:

1. Find the site's public address in the project (Next.js `metadataBase`, a sitemap, the package's homepage, deploy config); confirm it; call `setup_site`.
2. Collect the business facts the site states (name, what it offers and where, contact, address, hours, profiles); show them; call `set_business_details`. Never guess.
3. `draft_page_fix` for the home page and other key pages; show each draft; `approve_page_fix` the ones the user accepts, with their edits.

## Apply approved fixes

1. Call `seo_status`. It names the site, which pages have approved fixes, and which drafts are still waiting for approval.
2. Call `get_seo_fixes` (pass `path` for a single page). For each page:
   - Find where that page's `<head>` is produced. Use the framework's metadata API when there is one — Next.js `export const metadata` / `generateMetadata`, Nuxt `useHead`, SvelteKit `<svelte:head>`, Astro's `<head>`, Remix `meta`. Otherwise edit the HTML template.
   - Replace the existing `<title>` and `<meta name="description">` rather than adding second ones.
   - Add JSON-LD exactly as given. If a block of the same `@type` already exists, replace it. In JSX use `<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />`.
3. Show the user a short summary of what changed, per page.
4. After the user deploys, call `verify_page` with each live URL. Report anything still missing.

## Other tasks

- **Structured data only:** `get_structured_data` returns the JSON-LD for a page, built from the business details the owner entered.
- **llms.txt:** `generate_llms_txt`, then save the file at the site root — `public/llms.txt` in Next.js, Vite, Astro and Nuxt; `static/llms.txt` in SvelteKit and Hugo.
- **Audit:** `audit_page` checks any public URL. If the page is on the managed site and its title or description is weak, `draft_page_fix` saves a better draft in Populr for the owner to approve. It never overwrites an approved fix.

## Don't

- Don't invent titles, descriptions or facts for structured data. Use what Populr returns and what the site states; drafts go through `draft_page_fix`, and only the user decides what `approve_page_fix` approves.
- An approved fix goes live through Populr's snippet straight away if the snippet is installed — say so before approving.
- Don't put the Populr access key in the repository.
