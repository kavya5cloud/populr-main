# Populr SEO — Cursor plugin

Apply the SEO fixes you approve in [Populr](https://www.trypopulr.in) from Cursor's agent: titles, meta descriptions, JSON-LD structured data and llms.txt, written into your site's code and verified on the live site.

## Install

1. Create an access key at [trypopulr.in/app/keys](https://www.trypopulr.in/app/keys).
2. Install the plugin and set **POPULR_KEY** to your key when asked (or later under **Plugins → Configure**).
3. Ask the agent: *"Set up Populr SEO for this project"* — or run the `set-up-seo` command. It sets up the site, saves the business details, drafts and approves fixes with you, and applies them. After that, *"Apply my Populr SEO fixes"* (`apply-seo-fixes`) keeps things in step.

## What's inside

- **MCP server** `populr` — ten tools: `seo_status`, `setup_site`, `set_business_details`, `get_seo_fixes`, `get_structured_data`, `audit_page`, `draft_page_fix`, `approve_page_fix`, `generate_llms_txt`, `verify_page`. Four change your Populr settings (set up the site, save business details, draft and approve fixes), and Cursor asks you before running them. None edits your code or deploys; an approved fix goes live through Populr's snippet only if you've installed it.
- **Skill** `populr-seo` — the apply-and-verify workflow, framework by framework.
- **Rule** `populr-seo-head-tags` — no duplicate tags, JSX-safe JSON-LD.
- **Commands** `set-up-seo`, `apply-seo-fixes` and `seo-audit`.

Your key is stored by Cursor, never in this plugin. A key opens only your workspace's SEO settings; revoke it any time.

Docs: [trypopulr.in/developers/docs](https://www.trypopulr.in/developers/docs) · License: MIT
