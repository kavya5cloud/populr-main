// How to connect each editor to Populr's MCP server. One source for the landing page, the
// docs and the in-app key card, so the instructions can't disagree with each other.

export const MCP_URL = "https://www.trypopulr.in/api/mcp";

// One-click install links. The editor opens them itself and asks before adding anything.
//
// VS Code's link asks for the key when the server first starts and keeps it in secret
// storage, so the link carries no key and can sit on a public page. Cursor's link can't
// prompt, so it's built only with a key — right after one is created — and is handed to Cursor
// by the operating system; it isn't sent to any website.
export const VSCODE_INSTALL_URL = "vscode:mcp/install?" + encodeURIComponent(JSON.stringify({
  name: "populr",
  type: "http",
  url: MCP_URL,
  headers: { Authorization: "Bearer ${input:populr-key}" },
  inputs: [{ type: "promptString", id: "populr-key", description: "Populr access key (starts with pop_)", password: true }],
}));

export function cursorInstallUrl(key: string): string {
  const config = btoa(JSON.stringify({ url: MCP_URL, headers: { Authorization: `Bearer ${key}` } }));
  return `cursor://anysphere.cursor-deeplink/mcp/install?${new URLSearchParams({ name: "populr", config })}`;
}

export function installTabs(key = "YOUR_POPULR_KEY") {
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
