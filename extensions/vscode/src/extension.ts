import * as vscode from "vscode";
import { createHash, randomBytes } from "node:crypto";
import {
  callTool, checkServerUrl, DEFAULT_SERVER_URL, describeError, isKeyShaped, jsonLdFrom, KEYS_URL,
  listTools, llmsTxtFrom, PopulrError, structuredDataSnippet,
} from "./core";

// Populr SEO for VS Code (and Cursor).
//
// Registers Populr's MCP server with the editor, so its tools show up in the agent with no
// mcp.json to write, and adds a few commands that use the same tools directly. The access key
// lives in the editor's secret storage and is only ever sent to the Populr server URL.
//
// VS Code takes the HTTP server directly. Cursor's extension API can't send headers to a
// remote server, so there the extension registers a small local stdio relay (proxy.ts) that
// adds the key — run by Cursor's own runtime, so nothing else needs installing.

const SECRET = "populr.key";
const PROVIDER_ID = "populr";
const LABEL = "Populr SEO";

type CursorMcp = { registerServer(config: unknown): void | Promise<void>; unregisterServer(name: string): void | Promise<void> };
const cursorMcp = (vscode as unknown as { cursor?: { mcp?: CursorMcp } }).cursor?.mcp;

export function activate(context: vscode.ExtensionContext) {
  const out = vscode.window.createOutputChannel("Populr");
  const changed = new vscode.EventEmitter<void>();
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 20);
  context.subscriptions.push(out, changed, status);

  const getKey = async () => (await context.secrets.get(SECRET)) ?? "";

  // `populr.serverUrl` is an application-scoped setting: a workspace's .vscode/settings.json
  // can't change where the key is sent.
  const serverUrl = (): string | null => {
    const raw = vscode.workspace.getConfiguration("populr").get<string>("serverUrl") || DEFAULT_SERVER_URL;
    return checkServerUrl(raw)?.toString() ?? null;
  };

  const refreshStatus = async () => {
    const connected = !!(await getKey());
    status.text = connected ? "$(check) Populr" : "$(plug) Populr";
    status.tooltip = connected ? "Populr SEO is connected. Click for your SEO status." : "Connect Populr SEO";
    status.command = connected ? "populr.status" : "populr.connect";
    status.show();
  };

  context.subscriptions.push(
    context.secrets.onDidChange((e) => {
      if (e.key !== SECRET) return;
      changed.fire();
      void refreshStatus();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("populr.serverUrl")) changed.fire();
    }),
  );

  // The MCP server, offered to VS Code only while a key is stored.
  const definition = (url: string, key: string) =>
    new vscode.McpHttpServerDefinition(LABEL, vscode.Uri.parse(url), { Authorization: `Bearer ${key}` }, "1.0.0");

  const provider: vscode.McpServerDefinitionProvider<vscode.McpHttpServerDefinition> = {
    onDidChangeMcpServerDefinitions: changed.event,
    provideMcpServerDefinitions: async () => {
      const [url, key] = [serverUrl(), await getKey()];
      return url && key ? [definition(url, key)] : [];
    },
    // Read the key again when VS Code starts the server, so a replaced key is the one used.
    resolveMcpServerDefinition: async (server) => {
      const [url, key] = [serverUrl(), await getKey()];
      if (!url || !key) {
        void vscode.window.showWarningMessage("Populr isn't connected.", "Connect").then((a) => a && vscode.commands.executeCommand("populr.connect"));
        return undefined;
      }
      server.uri = vscode.Uri.parse(url);
      server.headers = { ...server.headers, Authorization: `Bearer ${key}` };
      return server;
    },
  };
  // Cursor: (re)register the relay when the key or server URL changes, and drop it on
  // disconnect. The key travels in the relay's environment, not its arguments. Changes run one
  // at a time — an unregister racing a register can leave a relay Cursor no longer tracks.
  //
  // Each registration also gets a one-time session token in a file only this extension
  // writes. The relay exits as soon as the file is gone or holds a different token, so
  // disconnecting (or replacing the key) stops it even if Cursor leaves the process running.
  const sessionFile = vscode.Uri.joinPath(context.globalStorageUri, "relay-session");
  let registered: string | null = null;
  let queue: Promise<void> = Promise.resolve();
  const syncCursor = () => {
    queue = queue.then(async () => {
      if (!cursorMcp) return;
      const [url, key] = [serverUrl(), await getKey()];
      const want = url && key ? createHash("sha256").update(`${url}\n${key}`).digest("hex") : null;
      if (want === registered) return;
      if (registered) {
        await Promise.resolve(cursorMcp.unregisterServer(PROVIDER_ID)).catch(() => undefined);
        registered = null;
      }
      if (!url || !key || !want) {
        await vscode.workspace.fs.delete(sessionFile).then(undefined, () => undefined);
        return;
      }
      const session = randomBytes(16).toString("hex");
      await vscode.workspace.fs.createDirectory(context.globalStorageUri);
      await vscode.workspace.fs.writeFile(sessionFile, new TextEncoder().encode(session));
      await Promise.resolve(cursorMcp.registerServer({
        name: PROVIDER_ID,
        server: {
          command: process.execPath,
          args: [context.asAbsolutePath("out/proxy.js")],
          env: { ELECTRON_RUN_AS_NODE: "1", POPULR_URL: url, POPULR_KEY: key, POPULR_SESSION_FILE: sessionFile.fsPath, POPULR_SESSION: session },
        },
      }));
      registered = want;
    }).catch(() => undefined);
    return queue;
  };

  if (cursorMcp) {
    context.subscriptions.push(changed.event(() => void syncCursor()), {
      dispose: () => {
        try { void Promise.resolve(cursorMcp.unregisterServer(PROVIDER_ID)).catch(() => undefined); } catch { /* gone */ }
        void vscode.workspace.fs.delete(sessionFile).then(undefined, () => undefined);
      },
    });
    void syncCursor();
  } else if (vscode.lm?.registerMcpServerDefinitionProvider) {
    context.subscriptions.push(vscode.lm.registerMcpServerDefinitionProvider(PROVIDER_ID, provider));
  }

  // Everything a command needs before it can call a tool. Offers to connect when there's no key.
  const session = async (): Promise<{ url: string; key: string } | null> => {
    const url = serverUrl();
    if (!url) {
      void vscode.window.showErrorMessage("The Populr server URL in your settings isn't a valid HTTPS address.", "Open settings")
        .then((a) => a && vscode.commands.executeCommand("workbench.action.openSettings", "populr.serverUrl"));
      return null;
    }
    const key = await getKey();
    if (key) return { url, key };
    const a = await vscode.window.showInformationMessage("Connect Populr first — you'll need an access key.", "Connect", "Get a key");
    if (a === "Get a key") void vscode.env.openExternal(vscode.Uri.parse(KEYS_URL));
    if (a === "Connect") await vscode.commands.executeCommand("populr.connect");
    const after = await getKey();
    return after ? { url, key: after } : null;
  };

  const run = async (title: string, name: string, args: Record<string, unknown> = {}) => {
    const s = await session();
    if (!s) return null;
    try {
      return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, () => callTool(s.url, s.key, name, args));
    } catch (e) {
      const auth = e instanceof PopulrError && e.kind === "auth";
      void vscode.window.showErrorMessage(describeError(e), ...(auth ? ["Connect again"] : []))
        .then((a) => a && vscode.commands.executeCommand("populr.connect"));
      return null;
    }
  };

  const show = (heading: string, text: string) => {
    out.appendLine(`── ${heading} · ${new Date().toLocaleString()}`);
    out.appendLine(text);
    out.appendLine("");
    out.show(true);
  };

  const command = (id: string, fn: () => Promise<unknown>) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  command("populr.connect", async () => {
    const url = serverUrl();
    if (!url) {
      void vscode.window.showErrorMessage("The Populr server URL in your settings isn't a valid HTTPS address.");
      return;
    }
    const key = await vscode.window.showInputBox({
      title: "Connect Populr SEO",
      prompt: `Paste a Populr access key. Create one at ${KEYS_URL.replace("https://", "")}.`,
      placeHolder: "pop_…",
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) => (!v.trim() || isKeyShaped(v) ? null : "A Populr key starts with pop_ and is 47 characters long."),
    });
    if (!key?.trim()) return;
    try {
      const tools = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Checking your key with Populr…" }, () => listTools(url, key.trim()));
      await context.secrets.store(SECRET, key.trim());
      const where = cursorMcp ? "Cursor's agent" : "chat (agent mode)";
      const a = await vscode.window.showInformationMessage(`Populr connected — ${tools.length} tools are ready in ${where}.`, "Show SEO status");
      if (a) await vscode.commands.executeCommand("populr.status");
    } catch (e) {
      void vscode.window.showErrorMessage(describeError(e));
    }
  });

  command("populr.disconnect", async () => {
    await context.secrets.delete(SECRET);
    void vscode.window.showInformationMessage(`Populr disconnected. The key is no longer stored in ${vscode.env.appName} — revoke it in Populr if you won't use it again.`);
  });

  command("populr.status", async () => {
    const r = await run("Reading your SEO status…", "seo_status");
    if (r) show("SEO status", r.text);
  });

  command("populr.auditPage", async () => {
    const url = await vscode.window.showInputBox({
      title: "Audit a page",
      prompt: "The page's full public URL",
      placeHolder: "https://example.com/about",
      ignoreFocusOut: true,
      validateInput: (v) => (/^https?:\/\/\S+\.\S+/i.test(v.trim()) ? null : "Enter a full URL starting with https://"),
    });
    if (!url) return;
    const r = await run(`Auditing ${url.trim()}…`, "audit_page", { url: url.trim() });
    if (r) show("Audit", r.text);
  });

  command("populr.insertStructuredData", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showInformationMessage("Open the file for the page's <head> first, and put the cursor where the structured data should go.");
      return;
    }
    const path = await vscode.window.showInputBox({
      title: "Insert structured data",
      prompt: "Which page is this? Its path on your site.",
      value: "/",
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim().startsWith("/") ? null : "A path starts with /, like / or /about"),
    });
    if (!path) return;
    const r = await run("Getting structured data…", "get_structured_data", { path: path.trim() });
    if (!r) return;
    const objects = jsonLdFrom(r.text);
    if (!objects.length) {
      void vscode.window.showInformationMessage(r.text);
      return;
    }
    const line = editor.document.lineAt(editor.selection.active.line);
    const indent = line.text.slice(0, line.firstNonWhitespaceCharacterIndex);
    const snippet = structuredDataSnippet(objects, editor.document.languageId, indent);
    await editor.edit((b) => b.replace(editor.selection, snippet));
    void vscode.window.showInformationMessage(`Inserted ${objects.length} structured data block${objects.length === 1 ? "" : "s"} for ${path.trim()}. If the page already has JSON-LD of the same type, remove the old one.`);
  });

  command("populr.createLlmsTxt", async () => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!folders.length) {
      void vscode.window.showInformationMessage("Open your site's folder first — llms.txt is written into it.");
      return;
    }
    const folder = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick({ placeHolder: "Which folder is your site?" });
    if (!folder) return;
    const r = await run("Building llms.txt…", "generate_llms_txt");
    if (!r) return;
    const body = llmsTxtFrom(r.text);
    if (!body) {
      void vscode.window.showInformationMessage(r.text);
      return;
    }
    // The folder a framework serves at the site root: public/ (Next, Vite, Astro, Nuxt) or
    // static/ (SvelteKit, Hugo). A new public/ if there's neither.
    const isDir = (u: vscode.Uri) => vscode.workspace.fs.stat(u).then((s) => (s.type & vscode.FileType.Directory) !== 0, () => false);
    const dir = (await isDir(vscode.Uri.joinPath(folder.uri, "public"))) || !(await isDir(vscode.Uri.joinPath(folder.uri, "static"))) ? "public" : "static";
    const target = vscode.Uri.joinPath(folder.uri, dir, "llms.txt");
    const exists = await vscode.workspace.fs.stat(target).then(() => true, () => false);
    if (exists) {
      const ok = await vscode.window.showWarningMessage(`${dir}/llms.txt already exists. Replace it?`, { modal: true }, "Replace");
      if (ok !== "Replace") return;
    }
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, dir));
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(body));
    await vscode.window.showTextDocument(target);
    void vscode.window.showInformationMessage(`Wrote ${dir}/llms.txt. Deploy, and it's served at /llms.txt.`);
  });

  void refreshStatus();
}

export function deactivate() {}
