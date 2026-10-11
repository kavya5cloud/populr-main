# Changelog

## 1.0.2

- Installs on VS Code 1.82 and later (was 1.101). The commands work everywhere.
- VS Code 1.100: Populr is added to VS Code's MCP settings, with the key as a VS Code input — VS Code asks for it once and keeps it in its secret storage, never in settings.json.
- Fixed: on VS Code 1.100 the extension failed to activate, because the MCP provider API is only a proposal there.

## 1.0.1

- Works with Cursor's agent: Populr is registered as an MCP server in Cursor through a local relay that adds your key, and stops when you disconnect.
- Messages name the editor you're using.

## 1.0.0

- Populr's MCP server registered with VS Code's agent mode.
- Commands: Connect, Show SEO status, Audit a page, Insert structured data, Create llms.txt, Disconnect.
