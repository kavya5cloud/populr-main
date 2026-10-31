import type { Metadata } from "next";
import { TOOLS } from "@/lib/mcp/tools";
import { SUPPORTED_VERSIONS } from "@/lib/mcp/server";
import { cursorInstallUrl, MCP_URL, VSCODE_INSTALL_URL, installTabs } from "@/lib/mcp/install";
import { CopyBlock, InstallTabs } from "../DevClient";
import { OG_DEFAULTS } from "@/lib/seo";

// The developer documentation. The tools reference is generated from the server's own tool
// definitions, so the docs can't describe a tool the server doesn't have or miss one it does.

export const metadata: Metadata = {
  title: "MCP server docs",
  description: "Set up Populr's MCP server in Claude Code, Cursor, VS Code or Windsurf: sign-in or access keys, every tool, the apply-and-verify workflow, and limits.",
  alternates: { canonical: "/developers/docs" },
  openGraph: { ...OG_DEFAULTS, type: "article", url: "/developers/docs", title: "Populr MCP server — documentation", description: "Setup, tools reference, workflow, security and troubleshooting." },
  twitter: { card: "summary_large_image", title: "Populr MCP docs", description: "Setup, tools reference, workflow and troubleshooting." },
};

const SECTIONS = [
  ["overview", "Overview"], ["quickstart", "Quickstart"], ["connect", "Connect your editor"], ["vscode", "VS Code & Cursor extension"],
  ["workflow", "The workflow"], ["tools", "Tools reference"], ["keys", "Access keys & security"], ["limits", "Limits"],
  ["troubleshooting", "Troubleshooting"], ["protocol", "Protocol details"],
] as const;

const props = (t: (typeof TOOLS)[number]) =>
  Object.entries(t.inputSchema.properties as Record<string, { type: string; description?: string }>).map(([name, p]) => ({ name, ...p, required: (t.inputSchema.required ?? []).includes(name) }));

export default function Docs() {
  return (
    <div className="dv dv-docs">
      <div className="dvd-top">
        <a href="/developers" className="dv-logo">Populr.</a>
        <span className="dvd-crumb">/ developers / docs</span>
        <a href="/app/keys" className="dv-btn small">Get a key</a>
      </div>
      <div className="dvd-grid">
        <aside className="dvd-toc" aria-label="On this page">
          {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
        </aside>

        <article className="dvd-body">
          <h1>Populr MCP server</h1>
          <p className="dvd-lede">Give your AI coding assistant the SEO changes your team approved in Populr, so it can apply them in your site&apos;s code and confirm they&apos;re live.</p>

          <section id="overview">
            <h2>Overview</h2>
            <p>Populr drafts better page titles, meta descriptions and structured data for a business&apos;s website, from what each page actually says, and the owner approves them. Populr can apply approved changes with a one-line script, which Google reads. The MCP server hands the same approved changes to an assistant working in the site&apos;s code — so they end up in the HTML as served, which every search engine, AI crawler and link preview reads.</p>
            <p><b>Or turn it on and let Populr do the rest.</b> One step — <b>Populr: Turn on</b> in VS Code or Cursor, or the <code>turn_on</code> tool from any agent — writes today&apos;s fixes into your code once and adds Populr&apos;s one-line snippet. From then on Populr fixes broken titles and descriptions itself, new pages included, through the snippet: no more code changes for SEO. Turning it on is the approval; every automatic fix is listed in Populr with an undo.</p>
            <p>The server speaks the <a href="https://modelcontextprotocol.io" rel="noopener">Model Context Protocol</a> over HTTP. Anything that supports remote MCP servers can use it.</p>
          </section>

          <section id="quickstart">
            <h2>Quickstart</h2>
            <ol>
              <li>Open <a href="/app/keys"><b>Access keys</b></a> in Populr and create one. Copy it — it&apos;s shown once — and the setup for your editor appears with the key filled in.</li>
              <li>On the same page, set up the <b>SEO autopilot</b> for your site and approve at least one page fix.</li>
              <li>Add Populr to your editor (below), then ask your assistant: <i>&ldquo;Apply my Populr SEO fixes.&rdquo;</i></li>
            </ol>
            <CopyBlock label="Server URL" code={MCP_URL} />
          </section>

          <section id="connect">
            <h2>Connect your editor</h2>
            <p><b>Sign in (recommended):</b> give your editor just the server URL. The first time it connects, it opens Populr in your browser; sign in and click <b>Allow</b>. There&apos;s nothing to copy, the sign-in renews itself, and you can disconnect the app any time on <a href="/app/keys">the keys page</a>. It&apos;s standard MCP authorization — OAuth 2.1 with PKCE — supported by Claude Code, VS Code, Cursor and Smithery.</p>
            <p><b>Or an access key:</b> send it as <code>Authorization: Bearer &lt;key&gt;</code> — or as <code>X-Populr-Key: &lt;key&gt;</code>, for gateways that can&apos;t add the <code>Bearer</code> prefix. Keep keys out of version control.</p>
            <p><b>One click:</b> <a href={cursorInstallUrl()}>Add to Cursor</a> (Cursor adds Populr and asks you to sign in), or <a href={VSCODE_INSTALL_URL}>Add to VS Code</a> (installs the Populr extension). There&apos;s also the <a href="https://cursor.directory/plugins/populr" target="_blank" rel="noopener">Populr plugin for Cursor</a>, with a skill, a rule and commands.</p>
            <InstallTabs tabs={installTabs()} />
            <p><b>Other clients:</b> any MCP client that supports the Streamable HTTP transport with a custom header will work. Point it at the server URL above.</p>
          </section>

          <section id="vscode">
            <h2>VS Code &amp; Cursor extension</h2>
            <p>The Populr extension registers Populr with your editor&apos;s agent, so there&apos;s no <code>mcp.json</code> to write. It installs as <code>populr.populr-seo</code>.</p>
            <ol>
              <li>Install it:
                <ul>
                  <li><b>Cursor</b> — search <b>Populr SEO</b> in the Extensions panel (it&apos;s on <a href="https://open-vsx.org/extension/populr/populr-seo" target="_blank" rel="noopener">Open VSX</a>).</li>
                  <li><b>VS Code</b> — search <b>Populr SEO</b> in the Extensions view (it&apos;s on the <a href="https://marketplace.visualstudio.com/items?itemName=Populr.populr-seo" target="_blank" rel="noopener">Visual Studio Marketplace</a>). Works in VS Code 1.82+; the agent tools need 1.100 or later. Offline or locked down? <a href="/downloads/populr-seo.vsix" download>Download the .vsix</a> and run <b>Extensions: Install from VSIX…</b></li>
                </ul>
              </li>
              <li>Sign in. There&apos;s no key to copy: the first time the agent uses Populr, <b>VS Code</b> asks you to sign in to Populr in your browser; in <b>Cursor</b>, click <b>Login</b> next to Populr under <b>Cursor Settings → MCP</b>. <b>Populr: Connect</b> takes you there too.</li>
              <li>Run <b>Populr: Turn on</b> — or click <b>Turn on</b> when the extension offers it in a website project. It hands the job to your editor&apos;s agent with Populr&apos;s instructions: in VS Code, agent chat starts by itself (allow the <code>turn_on</code> tool when asked); in Cursor, the prompt opens in chat and you press Enter. The agent writes the fixes, structured data, llms.txt and the snippet into your code. Deploy, and Populr keeps the site fixed from there.</li>
            </ol>
            <p>Rather drive it yourself? Ask the agent anything — in VS Code, open chat in <b>Agent</b> mode, where Populr&apos;s tools are in the tools picker; in Cursor, Populr is listed under MCP servers.</p>
            <p><b>Prefer an access key?</b> Run <b>Populr: Connect</b>, choose <b>Use an access key</b> and paste it; it&apos;s kept in the editor&apos;s secret storage. Keys are also what VS Code 1.100 uses, and what the commands below use in Cursor (Cursor&apos;s sign-in belongs to its agent). In Cursor, a key goes through a small local relay that adds it to each request — Cursor&apos;s extension API can&apos;t send it to a remote server directly. The relay gets the key through its environment, never its command line, and stops when you disconnect.</p>
            <p>Commands it adds:</p>
            <ul>
              <li><b>Populr: Turn on</b> — the one step: your agent sets the site up in code, and Populr keeps it fixed.</li>
              <li><b>Populr: Show SEO status</b> — what&apos;s approved and waiting.</li>
              <li><b>Populr: Audit a page</b> — on-page problems of any public URL, in the Populr output panel.</li>
              <li><b>Populr: Insert structured data</b> — the approved JSON-LD for a page, at the cursor. In <code>.tsx</code>/<code>.jsx</code> files it&apos;s written the way React needs it.</li>
              <li><b>Populr: Create llms.txt</b> — writes it to your site&apos;s <code>public/</code> folder (or <code>static/</code>, for SvelteKit and Hugo).</li>
              <li><b>Populr: Disconnect</b> — forgets the key. A sign-in belongs to the editor: end it by disconnecting the app on <a href="/app/keys">the keys page</a>.</li>
            </ul>
          </section>

          <section id="workflow">
            <h2>The workflow</h2>
            <p><b>Fastest:</b> turn it on — the <code>turn_on</code> prompt (in Claude Code, <code>/mcp__populr__turn_on</code>), <b>Populr: Turn on</b> in the extension, or just <i>&ldquo;Turn on Populr for this project.&rdquo;</i> One tool call sets everything up, and Populr applies fixes itself from then on.</p>
            <p><b>Step by step, approving each change:</b> the <code>set_up_seo</code> prompt (in Claude Code, <code>/mcp__populr__set_up_seo</code>), or <i>&ldquo;Set up Populr SEO for this project.&rdquo;</i> It does every step below and asks you before saving anything.</p>
            <ol>
              <li><code>seo_status</code> — what&apos;s set up, approved and waiting.</li>
              <li>First time: <code>setup_site</code> with the site&apos;s public address, then <code>set_business_details</code> with the facts the site states. No need to open Populr.</li>
              <li><code>draft_page_fix</code> for the main pages — Populr drafts a title and description from what each page says. Review them; <code>approve_page_fix</code> the ones you accept, with your edits.</li>
              <li><code>get_seo_fixes</code> — the exact tags. Apply them in the page <code>&lt;head&gt;</code> or your framework&apos;s metadata API (Next.js <code>export const metadata</code>, Nuxt <code>useHead</code>, Astro&apos;s <code>&lt;head&gt;</code>). Replace existing tags; don&apos;t add duplicates.</li>
              <li><code>generate_llms_txt</code> — save it as <code>public/llms.txt</code>.</li>
              <li>Deploy, then <code>verify_page</code> with the live URL — it checks each change is in the served HTML.</li>
            </ol>
            <p>Owners who prefer the web app can do steps 2–3 in Populr instead; the tools see the same settings.</p>
          </section>

          <section id="tools">
            <h2>Tools reference</h2>
            {TOOLS.map((t) => (
              <div key={t.name} className="dvd-tool" id={`tool-${t.name}`}>
                <h3><code>{t.name}</code> <span className={"dvd-badge" + (t.annotations.readOnlyHint ? "" : " w")}>{t.effect ?? "read-only"}</span></h3>
                <p>{t.description}</p>
                {props(t).length > 0 ? (
                  <table className="dvd-params">
                    <thead><tr><th>Input</th><th>Type</th><th>Description</th></tr></thead>
                    <tbody>{props(t).map((p) => (<tr key={p.name}><td><code>{p.name}</code>{p.required ? " *" : ""}</td><td>{p.type}</td><td>{p.description}</td></tr>))}</tbody>
                  </table>
                ) : <p className="dvd-none">No inputs.</p>}
              </div>
            ))}
            <p className="dvd-note">* required</p>
          </section>

          <section id="keys">
            <h2>Access keys &amp; security</h2>
            <ul>
              <li>A key belongs to one workspace and opens only its SEO settings. Nothing in a request can name another workspace.</li>
              <li>Keys start with <code>pop_</code> so secret scanners can recognise a leaked one. Populr stores only a SHA-256 fingerprint; the key is shown once.</li>
              <li>Revoke a key in Populr at any time; it stops working immediately. Each key shows when it was last used.</li>
              <li>{TOOLS.filter((t) => t.annotations.readOnlyHint).length} of the {TOOLS.length} tools only read. {TOOLS.filter((t) => !t.annotations.readOnlyHint).map((t, i, all) => <span key={t.name}><code>{t.name}</code>{i < all.length - 2 ? ", " : i === all.length - 2 ? " and " : ""}</span>)} change only your Populr settings, and are marked so your editor asks you before running them.</li>
              <li>No tool edits your code or deploys. Two have a live effect through Populr&apos;s snippet, where it&apos;s installed: <code>approve_page_fix</code> makes an approved fix live, and <code>turn_on</code> switches on automatic mode — Populr fixes broken titles and descriptions itself, never a page you undid, and at most ten new pages a day.</li>
              <li>Pages are fetched only from public addresses, with every redirect re-checked.</li>
            </ul>
          </section>

          <section id="limits">
            <h2>Limits</h2>
            <ul>
              <li>60 requests per minute per key. Over that, the server answers 429 with <code>Retry-After</code>.</li>
              <li>Up to 10 keys per workspace, and fixes for up to 50 pages.</li>
              <li>Fetched pages are capped at 3 MB and 15 seconds.</li>
            </ul>
          </section>

          <section id="troubleshooting">
            <h2>Troubleshooting</h2>
            <dl className="dv-faq">
              <div><dt>401 — &ldquo;Missing access key&rdquo; or &ldquo;isn&apos;t valid&rdquo;</dt><dd>Send the key as <code>Authorization: Bearer pop_…</code>. If it was revoked, create a new one.</dd></div>
              <div><dt>&ldquo;SEO autopilot isn&apos;t set up for this workspace&rdquo;</dt><dd>Set it up on the <a href="/app/keys">Access keys</a> page first; the tools read its settings.</dd></div>
              <div><dt><code>get_seo_fixes</code> returns nothing for a page</dt><dd>Only approved fixes are returned. Drafts wait for the owner&apos;s approval in Populr.</dd></div>
              <div><dt><code>verify_page</code> says a change is missing after deploying</dt><dd>Check the page isn&apos;t served from a stale cache, and that the change is in the server-rendered HTML rather than added later in the browser.</dd></div>
              <div><dt>The editor doesn&apos;t list Populr&apos;s tools</dt><dd>Restart the MCP connection after adding it, and check the client supports remote HTTP servers with headers.</dd></div>
            </dl>
          </section>

          <section id="protocol">
            <h2>Protocol details</h2>
            <ul>
              <li>Transport: Streamable HTTP. <code>POST</code> JSON-RPC 2.0 to <code>{MCP_URL}</code>; responses are <code>application/json</code>. No server-sent stream (<code>GET</code> returns 405) and no sessions.</li>
              <li>Protocol versions: {SUPPORTED_VERSIONS.join(", ")}. An unsupported request gets the latest.</li>
              <li>Methods: <code>initialize</code>, <code>ping</code>, <code>tools/list</code>, <code>tools/call</code>, <code>prompts/list</code>, <code>prompts/get</code>. Notifications are accepted with 202. Only <code>tools/call</code> needs a key.</li>
              <li>Prompts: <code>apply_seo_fixes</code> (optional <code>path</code>) and <code>seo_audit</code> (<code>url</code>) — clients that support prompts offer them as commands.</li>
              <li>Tool failures come back as results with <code>isError: true</code>, so the assistant can read them; protocol problems are JSON-RPC errors.</li>
            </ul>
            <CopyBlock label="Try it" code={`curl -s ${MCP_URL} \\\n  -H "Authorization: Bearer $POPULR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`} />
          </section>
        </article>
      </div>
    </div>
  );
}
