// How to connect each editor to Populr's MCP server. One source for the landing page, the
// docs and the in-app key card, so the instructions can't disagree with each other.

export const MCP_URL = "https://www.trypopulr.in/api/mcp";

// One-click install links. The editor opens them itself and asks before adding anything.
//
// VS Code's opens the Populr extension's page in VS Code — with its logo, description and an
// Install button. (A bare MCP install link can't carry a logo, and VS Code's MCP gallery
// doesn't list Populr.) The extension keeps the key in secret storage and adds the Populr
// commands. Cursor's link carries just the server URL and Cursor signs in to Populr itself;
// right after a key is created, the keys page offers one with the key in it instead. Either
// is handed to Cursor by the operating system — it isn't sent to any website.
export const VSCODE_EXTENSION_ID = "Populr.populr-seo";
export const VSCODE_INSTALL_URL = `vscode:extension/${VSCODE_EXTENSION_ID}`;

/** Without a key, Cursor adds the server and signs in to Populr itself (OAuth); with one, the key is in the config. */
export function cursorInstallUrl(key?: string): string {
  const config = btoa(JSON.stringify(key ? { url: MCP_URL, headers: { Authorization: `Bearer ${key}` } } : { url: MCP_URL }));
  return `cursor://anysphere.cursor-deeplink/mcp/install?${new URLSearchParams({ name: "populr", config })}`;
}

/**
 * Setup instructions per editor. Without a key: just the server URL — the editor signs in to
 * Populr in the browser the first time it connects (OAuth), so there's nothing to copy. With
 * a key (the keys page, right after creating one): the key-based config.
 */
export function installTabs(key?: string) {
  if (!key) {
    return [
      {
        id: "claude", name: "Claude Code", where: "In your project's terminal:",
        code: `claude mcp add --transport http populr ${MCP_URL}`,
        note: "Then run /mcp in Claude Code, pick populr and choose Authenticate — a browser tab opens to sign in to Populr.",
      },
      {
        id: "cursor", name: "Cursor", where: "In ~/.cursor/mcp.json (or .cursor/mcp.json in the project):",
        code: JSON.stringify({ mcpServers: { populr: { url: MCP_URL } } }, null, 2),
        note: "Cursor shows Populr as needing a login — click it and sign in.",
      },
      {
        id: "vscode", name: "VS Code", where: "Install the Populr extension — or add this to .vscode/mcp.json:",
        code: JSON.stringify({ servers: { populr: { type: "http", url: MCP_URL } } }, null, 2),
        note: "VS Code asks you to sign in to Populr the first time it starts the server.",
      },
      {
        id: "windsurf", name: "Windsurf", where: "In ~/.codeium/windsurf/mcp_config.json:",
        code: JSON.stringify({ mcpServers: { populr: { serverUrl: MCP_URL } } }, null, 2),
        note: "If your Windsurf doesn't offer to sign in, create a key on the keys page and add it as an Authorization header.",
      },
    ];
  }
  return [
    {
      id: "claude", name: "Claude Code", where: "In your project's terminal:",
      code: `claude mcp add --transport http populr ${MCP_URL} \\\n  --header "Authorization: Bearer ${key}"`,
      note: "Add --scope project to share it with your team through .mcp.json (keep the key out of version control — use an environment variable).",
    },
    {
      id: "cursor", name: "Cursor", where: "In ~/.cursor/mcp.json (or .cursor/mcp.json in the project):",
      code: JSON.stringify({ mcpServers: { populr: { url: MCP_URL, headers: { Authorization: `Bearer ${key}` } } } }, null, 2),
    },
    {
      id: "vscode", name: "VS Code", where: "Install the Populr extension and run “Populr: Connect” — or add this to .vscode/mcp.json:",
      code: JSON.stringify({
        inputs: [{ type: "promptString", id: "populr-key", description: "Populr access key", password: true }],
        servers: { populr: { type: "http", url: MCP_URL, headers: { Authorization: "Bearer ${input:populr-key}" } } },
      }, null, 2),
      note: "VS Code asks for the key once and stores it securely; it never sits in the file.",
    },
    {
      id: "windsurf", name: "Windsurf", where: "In ~/.codeium/windsurf/mcp_config.json:",
      code: JSON.stringify({ mcpServers: { populr: { serverUrl: MCP_URL, headers: { Authorization: `Bearer ${key}` } } } }, null, 2),
    },
  ];
}
