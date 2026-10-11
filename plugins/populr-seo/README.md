# Populr SEO — Cursor plugin

Apply the SEO fixes you approve in [Populr](https://www.trypopulr.in) from Cursor's agent: titles, meta descriptions, JSON-LD structured data and llms.txt, written into your site's code and verified on the live site.

## Install

1. Create an access key at [trypopulr.in/app/keys](https://www.trypopulr.in/app/keys).
2. Install the plugin and set **POPULR_KEY** to your key when asked (or later under **Plugins → Configure**).
3. Ask the agent: *"Apply my Populr SEO fixes"* — or run the `apply-seo-fixes` command.

## What's inside

- **MCP server** `populr` — seven tools: `seo_status`, `get_seo_fixes`, `get_structured_data`, `audit_page`, `draft_page_fix`, `generate_llms_txt`, `verify_page`. All read-only except `draft_page_fix`, which saves a draft for the site owner to approve.
- **Skill** `populr-seo` — the apply-and-verify workflow, framework by framework.
- **Rule** `populr-seo-head-tags` — no duplicate tags, JSX-safe JSON-LD.
- **Commands** `apply-seo-fixes` and `seo-audit`.

Your key is stored by Cursor, never in this plugin. A key opens only your workspace's SEO settings; revoke it any time.

Docs: [trypopulr.in/developers/docs](https://www.trypopulr.in/developers/docs) · License: MIT
