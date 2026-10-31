# Populr SEO for VS Code and Cursor

Apply the SEO fixes you approve in [Populr](https://www.trypopulr.in) from your editor's AI agent — in your site's code, where every search engine, AI crawler and link preview reads them.

## Get started

**Run Populr: Turn on** — or click **Turn on** when the extension offers it in a website project. That's the whole setup: your editor's agent writes today's SEO fixes into your code once — titles, descriptions, structured data, llms.txt — and adds Populr's one-line snippet. Deploy, and from then on Populr fixes broken titles and descriptions itself, new pages too, with no more code changes. Turning it on is the approval; every automatic fix is listed in Populr with an undo.

There's no key to copy, and no `mcp.json` to write:

- **VS Code** — open chat in **Agent** mode and ask *"Set up Populr SEO for this project."* The first time the agent uses Populr, VS Code asks you to sign in to Populr in your browser. That's it.
- **Cursor** — Populr appears under **Cursor Settings → MCP**. Click **Login** next to it, sign in, and ask the agent.
- **Windsurf and others** — the commands below work; for the agent, add Populr to your MCP config as shown in the [setup guide](https://www.trypopulr.in/developers/docs#connect).

**Populr: Connect** takes you to the sign-in, or lets you paste an access key instead (from [trypopulr.in/app/keys](https://www.trypopulr.in/app/keys)). A key is what VS Code 1.100 uses, and what the commands use in Cursor — Cursor's sign-in belongs to its agent. In Cursor, a key goes through a small local relay that adds it to each request, because Cursor's extension API can't send it to a remote server directly.

## Commands

| Command | What it does |
| --- | --- |
| **Populr: Turn on** | Hands the setup to your editor's agent with Populr's instructions. In VS Code, agent chat starts by itself; in Cursor, the prompt opens in chat and you press Enter. |
| **Populr: Connect** | Sign in with Populr, or paste an access key — it's checked with Populr and kept in the editor's secret storage. |
| **Populr: Show SEO status** | What's approved and ready to apply, and what's waiting for approval. |
| **Populr: Audit a page** | On-page SEO problems of any public URL, in the Populr output panel. |
| **Populr: Insert structured data** | The JSON-LD for a page, at the cursor. In `.tsx`/`.jsx` files it's written as a React-safe `<script dangerouslySetInnerHTML>`. |
| **Populr: Create llms.txt** | Writes `llms.txt` to your site's `public/` folder (or `static/`, for SvelteKit and Hugo). |
| **Populr: Disconnect** | Forgets the key. A sign-in belongs to the editor: end it on [the keys page](https://www.trypopulr.in/app/keys). |

## Tools for the agent

`seo_status`, `setup_site`, `set_business_details`, `get_seo_fixes`, `get_structured_data`, `audit_page`, `draft_page_fix`, `approve_page_fix`, `generate_llms_txt`, `verify_page`. Ask the agent *"Set up Populr SEO for this project"* and it does the lot — site, business details, drafted and approved fixes — asking you before anything is saved. Four tools change your Populr settings; none edits your code or deploys. An approved fix goes live through Populr's snippet only if you've installed it.

Full reference: [trypopulr.in/developers/docs](https://www.trypopulr.in/developers/docs).

## Security

- Signing in is standard MCP authorization (OAuth 2.1 with PKCE). The editor holds the sign-in, it renews itself, and you can end it any time on [the keys page](https://www.trypopulr.in/app/keys).
- A key is kept in the editor's secret storage, never in settings or files.
- It's sent only to the Populr server URL, over HTTPS. `populr.serverUrl` can be set in user settings only, so a workspace's `.vscode/settings.json` can't redirect your key.
- In Cursor, the relay gets the key through its environment, not its command line, and stops as soon as you disconnect.
- A key works only for the workspace that created it. Revoke it any time at [trypopulr.in/app/keys](https://www.trypopulr.in/app/keys).

Works in VS Code 1.82 or later and Cursor. Using Populr from the agent needs VS Code 1.100 or later; signing in without a key needs 1.101 or later (on 1.100, connect with a key — VS Code asks for it once more the first time the agent uses Populr).

## License

MIT — this covers the extension only. Populr itself is a hosted service with its own terms.
