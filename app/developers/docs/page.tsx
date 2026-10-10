import type { Metadata } from "next";
import { TOOLS } from "@/lib/mcp/tools";
import { SUPPORTED_VERSIONS } from "@/lib/mcp/server";
import { installTabs, MCP_URL } from "@/lib/mcp/install";
import { CopyBlock, InstallTabs } from "../DevClient";

// The developer documentation. The tools reference is generated from the server's own tool
// definitions, so the docs can't describe a tool the server doesn't have or miss one it does.

export const metadata: Metadata = {
  title: "MCP server docs",
  description: "Set up Populr's MCP server in Claude Code, Cursor, VS Code or Windsurf: access keys, every tool and its inputs, the apply-and-verify workflow, security, limits and troubleshooting.",
  alternates: { canonical: "/developers/docs" },
  openGraph: { type: "article", url: "/developers/docs", title: "Populr MCP server — documentation", description: "Setup, tools reference, workflow, security and troubleshooting." },
  twitter: { card: "summary_large_image", title: "Populr MCP docs", description: "Setup, tools reference, workflow and troubleshooting." },
};

const SECTIONS = [
  ["overview", "Overview"], ["quickstart", "Quickstart"], ["connect", "Connect your editor"], ["vscode", "VS Code extension"],
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
            <p>Every client sends the key as <code>Authorization: Bearer &lt;key&gt;</code>. Replace <code>YOUR_POPULR_KEY</code> with yours, and keep keys out of version control.</p>
            <InstallTabs tabs={installTabs()} />
            <p><b>Other clients:</b> any MCP client that supports the Streamable HTTP transport with a custom header will work. Point it at the server URL above.</p>
          </section>

          <section id="vscode">
            <h2>VS Code extension</h2>
            <p>The Populr extension registers Populr with VS Code&apos;s agent mode, so there&apos;s no <code>mcp.json</code> to write.</p>
            <ol>
              <li>Install the extension (<code>populr.populr-seo</code>).</li>
              <li>Run <b>Populr: Connect</b> from the Command Palette and paste your key. It&apos;s kept in VS Code&apos;s secret storage.</li>
              <li>Open Copilot Chat in <b>Agent</b> mode — Populr&apos;s tools are listed under the tools picker.</li>
            </ol>
            <p>Commands it adds:</p>
            <ul>
              <li><b>Populr: Show SEO status</b> — what&apos;s approved and waiting.</li>
              <li><b>Populr: Audit a page</b> — on-page problems of any public URL, in the Populr output panel.</li>
              <li><b>Populr: Insert structured data</b> — the approved JSON-LD for a page, at the cursor.</li>
              <li><b>Populr: Create llms.txt</b> — writes it to your workspace&apos;s <code>public/</code> folder.</li>
              <li><b>Populr: Disconnect</b> — forgets the key.</li>
            </ul>
          </section>

          <section id="workflow">
            <h2>The workflow</h2>
            <ol>
              <li><code>seo_status</code> — see what&apos;s approved for which pages.</li>
              <li><code>get_seo_fixes</code> — get the exact tags. Apply them in the page <code>&lt;head&gt;</code> or your framework&apos;s metadata API (Next.js <code>export const metadata</code>, Nuxt <code>useHead</code>, Astro&apos;s <code>&lt;head&gt;</code>). Replace existing tags; don&apos;t add duplicates.</li>
              <li>Deploy, then <code>verify_page</code> with the live URL — it checks each change is in the served HTML.</li>
            </ol>
            <p>To propose a change instead, <code>draft_page_fix</code> drafts one from the page&apos;s own text and saves it in Populr for the owner to approve. It never replaces an approved fix.</p>
          </section>

          <section id="tools">
            <h2>Tools reference</h2>
            {TOOLS.map((t) => (
              <div key={t.name} className="dvd-tool" id={`tool-${t.name}`}>
                <h3><code>{t.name}</code> <span className={"dvd-badge" + (t.annotations.readOnlyHint ? "" : " w")}>{t.annotations.readOnlyHint ? "read-only" : "writes a draft"}</span></h3>
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
              <li>Six of the seven tools only read. <code>draft_page_fix</code> saves a draft for approval. No tool publishes, approves, or changes a live site.</li>
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
              <li>Methods: <code>initialize</code>, <code>ping</code>, <code>tools/list</code>, <code>tools/call</code>. Notifications are accepted with 202.</li>
              <li>Tool failures come back as results with <code>isError: true</code>, so the assistant can read them; protocol problems are JSON-RPC errors.</li>
            </ul>
            <CopyBlock label="Try it" code={`curl -s ${MCP_URL} \\\n  -H "Authorization: Bearer $POPULR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`} />
          </section>
        </article>
      </div>
    </div>
  );
}
