# Changelog

## 1.1.0

- **Populr: Turn on** — one step to fix a site's SEO and keep it fixed. Your editor's agent writes today's fixes into the code once and adds Populr's snippet; Populr then fixes broken titles and descriptions itself, new pages too. Offered once when you open a website project. In VS Code agent chat starts by itself; in Cursor the prompt opens in chat (Cursor's documented prompt link) for you to send.
- No key needed: sign in with Populr instead. In VS Code 1.101+, the agent asks you to sign in the first time it uses Populr; in Cursor, Populr is listed under Cursor Settings → MCP with a Login button. Access keys keep working everywhere.
- **Populr: Connect** offers "Sign in with Populr" or "Use an access key". In VS Code, the commands work through the sign-in too.
- The extension starts with the editor, so Populr is in Cursor's MCP servers in every window, not just after you run a command.
- A Cursor sign-in survives restarts: the extension no longer unregisters Populr when it shuts down.
- Fixed: a waiting Cursor sign-in could hold up connecting with a key.

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
