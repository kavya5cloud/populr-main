import * as vscode from "vscode";
import { createHash, randomBytes } from "node:crypto";
import {
  callTool, checkServerUrl, DEFAULT_SERVER_URL, describeError, isKeyShaped, jsonLdFrom, KEYS_URL,
  listTools, llmsTxtFrom, PopulrError, structuredDataSnippet,
} from "./core";

// Populr SEO for VS Code (and Cursor).
//
// Registers Populr's MCP server with the editor, so its tools show up in the agent with no
// mcp.json to write, and adds a few commands that use the same tools directly.
//
// No key is needed: without one, Populr is registered by its address and the editor signs in
// itself ("Sign in with Populr" — OAuth), the first time it's used. A key, if the developer
// prefers one, lives in the editor's secret storage and is only ever sent to the Populr URL.
//
// VS Code takes the HTTP server directly. Cursor's extension API can't send headers to a
// remote server, so with a key the extension registers a small local stdio relay (proxy.ts)
// that adds it — run by Cursor's own runtime, so nothing else needs installing.

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
    const hasKey = !!(await getKey());
    const signIn = !hasKey && (mode === "provider" || mode === "cursor");
    status.text = hasKey ? "$(check) Populr" : signIn ? "$(globe) Populr" : "$(plug) Populr";
    status.tooltip = hasKey ? "Populr SEO is connected with a key. Click for your SEO status."
      : mode === "provider" ? "Populr SEO signs in through VS Code the first time it's used. Click for your SEO status."
      : mode === "cursor" ? "Populr SEO is in Cursor's MCP servers — sign in there. Click to connect."
      : "Connect Populr SEO";
    status.command = hasKey || mode === "provider" ? "populr.status" : "populr.connect";
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

  // ── How Populr reaches the editor's agent depends on the editor and its version ──
  //
  //   VS Code 1.101+   the MCP server-definition provider API: the key goes in a header, from
  //                    secret storage, and nothing is written to settings.
  //   VS Code 1.100    MCP servers came from settings ("mcp.servers"). Populr is written
  //                    there with the key as a VS Code input, so VS Code asks for it once and
  //                    keeps it in its own secret storage — never in settings.json.
  //   Cursor           a local stdio relay (see below).
  //   anything older   the commands still work; the agent needs a newer editor. (1.99 had
  //                    MCP, but not the HTTP transport Populr's server uses.)
  //
  // The types for the newer APIs are declared here rather than taken from @types/vscode, which
  // has to match the oldest version the extension supports.
  type HttpDef = { uri: vscode.Uri; headers: Record<string, string> };
  type HttpDefCtor = new (label: string, uri: vscode.Uri, headers?: Record<string, string>, version?: string) => HttpDef;
  type Provider = {
    onDidChangeMcpServerDefinitions?: vscode.Event<void>;
    provideMcpServerDefinitions(token: vscode.CancellationToken): Promise<HttpDef[]>;
    resolveMcpServerDefinition?(server: HttpDef, token: vscode.CancellationToken): Promise<HttpDef | undefined>;
  };
  const api = vscode as unknown as { lm?: { registerMcpServerDefinitionProvider?(id: string, p: Provider): vscode.Disposable }; McpHttpServerDefinition?: HttpDefCtor };
  const [major, minor] = vscode.version.split(".").map((n) => parseInt(n, 10));
  const atLeast = (m: number) => major > 1 || (major === 1 && minor >= m);
  const isVsCode = vscode.env.appName.startsWith("Visual Studio Code");
  // The provider API exists in 1.100 too, but as a proposal: calling it there throws, which
  // stopped the whole extension from activating. So it's used only once it's final (1.101).
  const HttpDefinition = atLeast(101) ? api.McpHttpServerDefinition : undefined;
  const settingsMode = isVsCode && atLeast(100) ? "settings" : "none";
  let mode: "provider" | "settings" | "cursor" | "none" =
    cursorMcp ? "cursor"
    : HttpDefinition && api.lm?.registerMcpServerDefinitionProvider ? "provider"
    : settingsMode;

  // VS Code 1.101+: the MCP server, always offered. With a key, it goes in a header; without
  // one, there's no header, Populr answers 401 with its sign-in metadata, and VS Code runs
  // "Sign in with Populr" itself. The version changes with the mode, so switching between a
  // key and sign-in makes VS Code pick up the new definition.
  const provider: Provider = {
    onDidChangeMcpServerDefinitions: changed.event,
    provideMcpServerDefinitions: async () => {
      const [url, key] = [serverUrl(), await getKey()];
      if (!url || !HttpDefinition) return [];
      return [new HttpDefinition(LABEL, vscode.Uri.parse(url), key ? { Authorization: `Bearer ${key}` } : {}, key ? "1.1.0-key" : "1.1.0-signin")];
    },
    // Read the key again when VS Code starts the server, so a replaced (or removed) key counts.
    resolveMcpServerDefinition: async (server) => {
      const [url, key] = [serverUrl(), await getKey()];
      if (!url) {
        void vscode.window.showErrorMessage("The Populr server URL in your settings isn't a valid HTTPS address.");
        return undefined;
      }
      server.uri = vscode.Uri.parse(url);
      const { Authorization: _drop, ...rest } = server.headers ?? {};
      server.headers = key ? { ...rest, Authorization: `Bearer ${key}` } : rest;
      return server;
    },
  };

  // VS Code 1.100: keep Populr's entry in the user's "mcp" settings in step with the
  // connection. Only Populr's own entry and input are touched.
  const INPUT_ID = "populr-key";
  const syncSettings = async () => {
    const [url, key] = [serverUrl(), await getKey()];
    const cfg = vscode.workspace.getConfiguration("mcp");
    const servers: Record<string, unknown> = { ...(cfg.get<Record<string, unknown>>("servers") ?? {}) };
    const inputs = (cfg.get<{ id?: string }[]>("inputs") ?? []).filter((i) => i?.id !== INPUT_ID);
    if (url && key) {
      servers[PROVIDER_ID] = { type: "http", url, headers: { Authorization: `Bearer \${input:${INPUT_ID}}` } };
      inputs.push({ type: "promptString", id: INPUT_ID, description: "Populr access key (starts with pop_) — the same key you connected with", password: true } as { id: string });
    } else {
      delete servers[PROVIDER_ID];
    }
    try {
      await cfg.update("servers", servers, vscode.ConfigurationTarget.Global);
      await cfg.update("inputs", inputs, vscode.ConfigurationTarget.Global);
    } catch {
      out.appendLine("Couldn't add Populr to VS Code's MCP settings. Update VS Code to use Populr in agent mode.");
    }
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
  // Cursor's register/unregister calls resolve only once its connection attempt settles — and
  // a server waiting for sign-in may not settle for a long time. Give each a few seconds, then
  // move on, so one waiting server can't hold up the next change (e.g. adding a key).
  const settle = (p: unknown) => Promise.race([Promise.resolve(p).catch(() => undefined), new Promise((r) => setTimeout(r, 3000))]);
  let queue: Promise<void> = Promise.resolve();
  const syncCursor = () => {
    queue = queue.then(async () => {
      if (!cursorMcp) return;
      const [url, key] = [serverUrl(), await getKey()];
      const want = !url ? null : key ? createHash("sha256").update(`${url}\n${key}`).digest("hex") : `signin:${url}`;
      if (want === registered) return;
      if (registered) {
        await settle(cursorMcp.unregisterServer(PROVIDER_ID));
        registered = null;
      }
      if (!url || !key || !want) {
        await vscode.workspace.fs.delete(sessionFile).then(undefined, () => undefined);
        if (!url || !want) return;
        // No key: register Populr by its address. Cursor sees the 401 and offers its own
        // login for it — "Sign in with Populr" — under Cursor Settings → MCP.
        await settle(cursorMcp.registerServer({ name: PROVIDER_ID, server: { url } }));
        registered = want;
        return;
      }
      const session = randomBytes(16).toString("hex");
      await vscode.workspace.fs.createDirectory(context.globalStorageUri);
      await vscode.workspace.fs.writeFile(sessionFile, new TextEncoder().encode(session));
      await settle(cursorMcp.registerServer({
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

  if (mode === "cursor" && cursorMcp) {
    context.subscriptions.push(changed.event(() => void syncCursor()), {
      dispose: () => {
        // Stop the relay on the way out. A sign-in registration is left alone: Cursor forgets a
        // server's sign-in when it's unregistered, and nobody should have to sign in again
        // every time Cursor restarts.
        if (registered && !registered.startsWith("signin:")) {
          try { void Promise.resolve(cursorMcp.unregisterServer(PROVIDER_ID)).catch(() => undefined); } catch { /* gone */ }
        }
        void vscode.workspace.fs.delete(sessionFile).then(undefined, () => undefined);
      },
    });
    void syncCursor();
  } else if (mode === "provider" && api.lm?.registerMcpServerDefinitionProvider) {
    try {
      context.subscriptions.push(api.lm.registerMcpServerDefinitionProvider(PROVIDER_ID, provider));
    } catch {
      // An editor that has the API but won't let this extension use it: fall back rather
      // than fail to activate, which would take the commands down with it.
      mode = settingsMode;
    }
  }
  if (mode === "settings") {
    context.subscriptions.push(changed.event(() => void syncSettings()));
  }

  // Where the tools appear, for the "connected" message.
  const agentNote = (tools: number) => ({
    cursor: `${tools} tools are ready in Cursor's agent.`,
    provider: `${tools} tools are ready in chat (agent mode).`,
    settings: `${tools} tools are ready in chat (agent mode). VS Code will ask for your key once more when the agent first uses Populr — paste the same key.`,
    none: `the commands work. To use Populr from the agent, update ${vscode.env.appName} — this version doesn't support MCP.`,
  })[mode];

  // Without a key, VS Code's own MCP client — which carries the editor's sign-in — runs the
  // tool. Its tools are named like mcp_populr_seo_<tool>.
  type LmTool = { name: string };
  type LmApi = { tools?: readonly LmTool[]; invokeTool?(name: string, options: { input: object; toolInvocationToken: undefined }): Thenable<{ content: unknown[] }> };
  const lm = (vscode as unknown as { lm?: LmApi }).lm;
  const serverId = `${context.extension.id.toLowerCase()}/${LABEL}`;
  const editorTool = (name: string) => lm?.tools?.find((t) => /populr/i.test(t.name) && t.name.endsWith(`_${name}`));
  const startServer = () =>
    Promise.resolve(vscode.commands.executeCommand("workbench.mcp.startServer", serverId, { waitForLiveTools: true })).then(() => true, () => false);
  const viaEditor = async (name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean } | null> => {
    let tool = editorTool(name);
    if (!tool) { await startServer(); tool = editorTool(name); }
    if (!tool || !lm?.invokeTool) return null;
    // A tool that fails in Populr comes back as a result; a throw means VS Code couldn't run
    // the server at all — almost always because the sign-in hasn't happened (or was cancelled).
    const r = await Promise.resolve(lm.invokeTool(tool.name, { input: args, toolInvocationToken: undefined })).catch(() => null);
    if (!r) throw new PopulrError("auth", "Populr didn't answer through VS Code. If VS Code asked you to sign in, finish that first — or connect with an access key.");
    const text = r.content.map((p) => (p as { value?: unknown }).value).filter((v): v is string => typeof v === "string").join("\n");
    return { text, isError: false };
  };

  // Everything a command needs before it can call a tool: a key, or (VS Code) the editor's
  // own sign-in. Offers to connect when there's neither.
  const session = async (): Promise<{ url: string; key: string } | { url: string; viaEditor: true } | null> => {
    const url = serverUrl();
    if (!url) {
      void vscode.window.showErrorMessage("The Populr server URL in your settings isn't a valid HTTPS address.", "Open settings")
        .then((a) => a && vscode.commands.executeCommand("workbench.action.openSettings", "populr.serverUrl"));
      return null;
    }
    const key = await getKey();
    if (key) return { url, key };
    if (mode === "provider") return { url, viaEditor: true };
    const a = await vscode.window.showInformationMessage(
      mode === "cursor" ? "In Cursor, the Populr commands need an access key (Cursor's agent signs in on its own)." : "Connect Populr first — you'll need an access key.",
      "Connect", "Get a key");
    if (a === "Get a key") void vscode.env.openExternal(vscode.Uri.parse(KEYS_URL));
    if (a === "Connect") await vscode.commands.executeCommand("populr.connect");
    const after = await getKey();
    return after ? { url, key: after } : null;
  };

  const run = async (title: string, name: string, args: Record<string, unknown> = {}) => {
    const s = await session();
    if (!s) return null;
    try {
      return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, async () => {
        if ("key" in s) return callTool(s.url, s.key, name, args);
        const r = await viaEditor(name, args);
        if (!r) throw new PopulrError("auth", "Populr isn't signed in yet. Sign in when VS Code asks, or connect with an access key.");
        return r;
      });
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
    // Sign-in first where the editor can do it; a key for everything else.
    if (mode === "provider" || mode === "cursor") {
      const pick = await vscode.window.showQuickPick([
        { label: "$(globe) Sign in with Populr", description: "Recommended — no key to copy", id: "signin" },
        { label: "$(key) Use an access key", description: "From trypopulr.in/app/keys", id: "key" },
      ], { title: "Connect Populr SEO", placeHolder: "How do you want to connect?" });
      if (!pick) return;
      if (pick.id === "signin") {
        if (await getKey()) {
          // Sign-in replaces a stored key. VS Code takes a moment to pick up the definition
          // without it; starting before then would start the old one.
          await context.secrets.delete(SECRET);
          if (mode === "provider") await new Promise((r) => setTimeout(r, 1500));
        }
        if (mode === "cursor") {
          void vscode.commands.executeCommand("aiSettings.action.open", "mcp").then(undefined, () => undefined);
          void vscode.window.showInformationMessage("Populr is in Cursor's MCP servers — click Login next to it and sign in. Cursor's agent can then use it.");
          return;
        }
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Starting Populr — sign in if VS Code asks…" }, () => startServer());
        // VS Code keeps a server's last tool list even when it's waiting for sign-in, so the
        // tools being listed doesn't prove anything. The status check does: it goes through
        // VS Code's sign-in and shows what Populr says.
        const a = await vscode.window.showInformationMessage(
          "If VS Code asked you to sign in to Populr, finish in your browser. Populr's tools are then in chat (agent mode).",
          "Show SEO status");
        if (a) await vscode.commands.executeCommand("populr.status");
        return;
      }
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
      const a = await vscode.window.showInformationMessage(`Populr connected — ${agentNote(tools.length)}`, "Show SEO status");
      if (a) await vscode.commands.executeCommand("populr.status");
    } catch (e) {
      void vscode.window.showErrorMessage(describeError(e));
    }
  });

  command("populr.disconnect", async () => {
    if (await getKey()) {
      await context.secrets.delete(SECRET);
      void vscode.window.showInformationMessage(`Populr disconnected. The key is no longer stored in ${vscode.env.appName} — revoke it in Populr if you won't use it again.`);
      return;
    }
    if (mode !== "provider" && mode !== "cursor") {
      void vscode.window.showInformationMessage("Populr isn't connected.");
      return;
    }
    // Signed in through the editor: the sign-in is the editor's, and Populr can end it too.
    const a = await vscode.window.showInformationMessage(
      `${vscode.env.appName} signed in to Populr itself. To sign out, disconnect it on Populr's keys page — it stops working at once.`,
      "Open the keys page");
    if (a) void vscode.env.openExternal(vscode.Uri.parse(KEYS_URL));
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
