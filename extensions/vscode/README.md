# Populr SEO for VS Code and Cursor

Apply the SEO fixes you approve in [Populr](https://www.trypopulr.in) from your editor's AI agent — in your site's code, where every search engine, AI crawler and link preview reads them.

## Get started

1. Create an access key at [trypopulr.in/app/keys](https://www.trypopulr.in/app/keys).
2. Run **Populr: Connect** from the Command Palette and paste the key.
3. Ask your agent: *"Apply my Populr SEO fixes."*

There's no `mcp.json` to write:

- **VS Code** — open chat in **Agent** mode; Populr's tools are in the tools picker.
- **Cursor** — Populr appears in Cursor's MCP servers and its tools are available to the agent. The extension runs a small local relay that adds your key to each request, because Cursor's extension API can't send it to a remote server directly.
- **Windsurf and others** — the commands below work; for the agent, add Populr to your MCP config as shown in the [setup guide](https://www.trypopulr.in/developers/docs#connect).

## Commands

| Command | What it does |
| --- | --- |
| **Populr: Connect** | Checks your key with Populr and stores it in the editor's secret storage. |
| **Populr: Show SEO status** | What's approved and ready to apply, and what's waiting for approval. |
| **Populr: Audit a page** | On-page SEO problems of any public URL, in the Populr output panel. |
| **Populr: Insert structured data** | The JSON-LD for a page, at the cursor. In `.tsx`/`.jsx` files it's written as a React-safe `<script dangerouslySetInnerHTML>`. |
| **Populr: Create llms.txt** | Writes `llms.txt` to your site's `public/` folder (or `static/`, for SvelteKit and Hugo). |
| **Populr: Disconnect** | Forgets the key. |

## Tools for the agent

`seo_status`, `setup_site`, `set_business_details`, `get_seo_fixes`, `get_structured_data`, `audit_page`, `draft_page_fix`, `approve_page_fix`, `generate_llms_txt`, `verify_page`. Ask the agent *"Set up Populr SEO for this project"* and it does the lot — site, business details, drafted and approved fixes — asking you before anything is saved. Four tools change your Populr settings; none edits your code or deploys. An approved fix goes live through Populr's snippet only if you've installed it.

Full reference: [trypopulr.in/developers/docs](https://www.trypopulr.in/developers/docs).

## Security

- The key is kept in the editor's secret storage, never in settings or files.
- It's sent only to the Populr server URL, over HTTPS. `populr.serverUrl` can be set in user settings only, so a workspace's `.vscode/settings.json` can't redirect your key.
- In Cursor, the relay gets the key through its environment, not its command line, and stops as soon as you disconnect.
- A key works only for the workspace that created it. Revoke it any time at [trypopulr.in/app/keys](https://www.trypopulr.in/app/keys).

Works in VS Code 1.82 or later and Cursor. Using Populr from the agent needs VS Code 1.100 or later (on 1.100, VS Code asks for your key once more the first time the agent uses Populr).

## License

MIT — this covers the extension only. Populr itself is a hosted service with its own terms.
