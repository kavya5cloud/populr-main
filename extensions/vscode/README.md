# Populr SEO for VS Code

Apply the SEO fixes you approve in [Populr](https://www.trypopulr.in) from VS Code — in your site's code, where every search engine, AI crawler and link preview reads them.

## Get started

1. Create an access key at [trypopulr.in/app/keys](https://www.trypopulr.in/app/keys).
2. Run **Populr: Connect** from the Command Palette and paste the key.
3. Open chat in **Agent** mode and ask: *"Apply my Populr SEO fixes."*

Populr's tools appear in the chat tools picker. There's no `mcp.json` to write.

## Commands

| Command | What it does |
| --- | --- |
| **Populr: Connect** | Checks your key with Populr and stores it in VS Code's secret storage. |
| **Populr: Show SEO status** | What's approved and ready to apply, and what's waiting for approval. |
| **Populr: Audit a page** | On-page SEO problems of any public URL, in the Populr output panel. |
| **Populr: Insert structured data** | The JSON-LD for a page, at the cursor. In `.tsx`/`.jsx` files it's written as a React-safe `<script dangerouslySetInnerHTML>`. |
| **Populr: Create llms.txt** | Writes `llms.txt` to your site's `public/` folder (or `static/`, for SvelteKit and Hugo). |
| **Populr: Disconnect** | Forgets the key. |

## Tools for the agent

`seo_status`, `get_seo_fixes`, `get_structured_data`, `audit_page`, `draft_page_fix`, `generate_llms_txt`, `verify_page`. Every tool is read-only except `draft_page_fix`, which saves a draft in Populr for the site owner to approve. Nothing changes your live site — your assistant edits your code, and you deploy.

Full reference: [trypopulr.in/developers/docs](https://www.trypopulr.in/developers/docs).

## Security

- The key is kept in VS Code's secret storage, never in settings or files.
- It's sent only to the Populr server URL, over HTTPS. `populr.serverUrl` can be set in user settings only, so a workspace's `.vscode/settings.json` can't redirect your key.
- A key works only for the workspace that created it. Revoke it any time at [trypopulr.in/app/keys](https://www.trypopulr.in/app/keys).

Requires VS Code 1.101 or later.
