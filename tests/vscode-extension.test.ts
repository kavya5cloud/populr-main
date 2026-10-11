import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  callTool, checkServerUrl, DEFAULT_SERVER_URL, forwardLine, isKeyShaped, jsonLdFrom, listTools, llmsTxtFrom, PopulrError, structuredDataSnippet,
} from "../extensions/vscode/src/core";
import { newKey } from "@/lib/mcp/keys";
import { MCP_URL } from "@/lib/mcp/install";

// The VS Code extension: its client for Populr's MCP server, and the promises its manifest
// and the docs make about it.

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(readFileSync(path.join(root, "extensions/vscode/package.json"), "utf8"));
const extensionSrc = readFileSync(path.join(root, "extensions/vscode/src/extension.ts"), "utf8");
const docs = readFileSync(path.join(root, "app/developers/docs/page.tsx"), "utf8");

function fakeFetch(status: number, body: unknown, contentType = "application/json") {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": contentType } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("extension client", () => {
  it("accepts exactly the keys Populr issues", () => {
    expect(isKeyShaped(newKey().key)).toBe(true);
    expect(isKeyShaped("pop_short")).toBe(false);
    expect(isKeyShaped("sk_" + "a".repeat(44))).toBe(false);
  });

  it("sends the key only to HTTPS, or to a server on this machine", () => {
    expect(checkServerUrl(DEFAULT_SERVER_URL)?.toString()).toBe(MCP_URL);
    expect(checkServerUrl("http://localhost:3011/api/mcp")).not.toBeNull();
    expect(checkServerUrl("http://evil.example/api/mcp")).toBeNull();
    expect(checkServerUrl("file:///etc/passwd")).toBeNull();
    expect(checkServerUrl("not a url")).toBeNull();
  });

  it("calls a tool as JSON-RPC with the key as a bearer token", async () => {
    const f = fakeFetch(200, { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "Site: https://x.in" }], isError: false } });
    const r = await callTool(MCP_URL, "pop_k", "seo_status", {}, { fetch: f.fn });
    expect(r).toEqual({ text: "Site: https://x.in", isError: false });
    const headers = f.calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer pop_k");
    expect(headers.Accept).toContain("text/event-stream");
    const body = JSON.parse(String(f.calls[0].init.body));
    expect(body).toMatchObject({ jsonrpc: "2.0", method: "tools/call", params: { name: "seo_status", arguments: {} } });
  });

  it("reads an event-stream answer too", async () => {
    const msg = { jsonrpc: "2.0", id: 1, result: { tools: [{ name: "seo_status" }, { name: "verify_page" }] } };
    const f = fakeFetch(200, `event: message\ndata: ${JSON.stringify(msg)}\n\n`, "text/event-stream");
    expect(await listTools(MCP_URL, "pop_k", { fetch: f.fn })).toEqual(["seo_status", "verify_page"]);
  });

  it("turns a rejected key, a rate limit and an outage into messages a person can act on", async () => {
    const auth = fakeFetch(401, { jsonrpc: "2.0", id: null, error: { code: -32001, message: "That access key isn't valid. It may have been revoked." } });
    await expect(listTools(MCP_URL, "pop_k", { fetch: auth.fn })).rejects.toMatchObject({ kind: "auth", message: expect.stringContaining("revoked") });
    const rate = fakeFetch(429, { jsonrpc: "2.0", id: null, error: { code: -32002, message: "Rate limited. Try again in 12s." } });
    await expect(listTools(MCP_URL, "pop_k", { fetch: rate.fn })).rejects.toMatchObject({ kind: "rate" });
    const down = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    await expect(listTools(MCP_URL, "pop_k", { fetch: down })).rejects.toBeInstanceOf(PopulrError);
    const html = fakeFetch(502, "<html>Bad gateway</html>", "text/html");
    await expect(listTools(MCP_URL, "pop_k", { fetch: html.fn })).rejects.toMatchObject({ kind: "server" });
  });

  it("takes the file out of generate_llms_txt, and leaves messages alone", () => {
    expect(llmsTxtFrom("Save this as llms.txt at the root of https://x.in (in most frameworks: public/llms.txt):\n\n# X\n\n> Y")).toBe("# X\n\n> Y\n");
    expect(llmsTxtFrom("Fill in the business details in Populr first — llms.txt starts with what the business is.")).toBeNull();
  });

  const toolText = `<script type="application/ld+json">\n${JSON.stringify({ "@type": "Store", name: "A </script> B" }, null, 2).replace(/</g, "\\u003c")}\n</script>\n\nIf the page already has JSON-LD of the same @type, replace it rather than adding a second copy.`;

  it("pulls the JSON-LD objects out of get_structured_data", () => {
    expect(jsonLdFrom(toolText)).toEqual([{ "@type": "Store", name: "A </script> B" }]);
    expect(jsonLdFrom("The business details aren't filled in yet")).toEqual([]);
  });

  it("writes a plain script tag in HTML, escaped so a value can't close it", () => {
    const s = structuredDataSnippet(jsonLdFrom(toolText), "html");
    expect(s.startsWith('<script type="application/ld+json">')).toBe(true);
    expect(s.match(/<\/script>/g)).toHaveLength(1);
    expect(JSON.parse(s.replace(/^<script[^>]*>|<\/script>$/g, ""))).toEqual({ "@type": "Store", name: "A </script> B" });
  });

  it("writes React's pattern in JSX, where braces in raw JSON would break the file", () => {
    const s = structuredDataSnippet(jsonLdFrom(toolText), "typescriptreact", "    ");
    expect(s).toContain("dangerouslySetInnerHTML={{ __html: JSON.stringify(");
    expect(s).toContain('.replace(/</g, "\\\\u003c")');
    expect(s.trimEnd().endsWith("/>")).toBe(true);
    // The object literal inside is valid JavaScript that evaluates to the same data.
    const literal = s.slice(s.indexOf("JSON.stringify(") + 15, s.lastIndexOf(").replace"));
    expect(new Function(`return ${literal}`)()).toEqual({ "@type": "Store", name: "A </script> B" });
  });
});

describe("Cursor relay", () => {
  it("forwards a request with the key and returns the answer under the caller's id", async () => {
    const f = fakeFetch(200, { jsonrpc: "2.0", id: 4, result: { tools: [] } });
    const out = await forwardLine(MCP_URL, "pop_k", JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list" }), { fetch: f.fn });
    expect(JSON.parse(out!)).toEqual({ jsonrpc: "2.0", id: 4, result: { tools: [] } });
    expect((f.calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer pop_k");
    expect(f.calls[0].init.body).toBe(JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list" }));
  });

  it("writes nothing back for a notification", async () => {
    const f = fakeFetch(202, "");
    expect(await forwardLine(MCP_URL, "pop_k", JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), { fetch: f.fn })).toBeNull();
  });

  it("ties a rejected key to the request that hit it, so the editor shows why", async () => {
    // Populr answers 401 with id null (it can't trust the body before checking the key).
    const f = fakeFetch(401, { jsonrpc: "2.0", id: null, error: { code: -32001, message: "That access key isn't valid. It may have been revoked." } });
    const out = JSON.parse((await forwardLine(MCP_URL, "pop_k", JSON.stringify({ jsonrpc: "2.0", id: "a", method: "tools/list" }), { fetch: f.fn }))!);
    expect(out).toMatchObject({ id: "a", error: { code: -32001, message: expect.stringContaining("revoked") } });
  });

  it("answers an outage or a garbled reply with an error instead of hanging", async () => {
    const down = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    expect(JSON.parse((await forwardLine(MCP_URL, "pop_k", JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }), { fetch: down }))!)).toMatchObject({ id: 1, error: { code: -32603 } });
    const html = fakeFetch(502, "<html>Bad gateway</html>", "text/html");
    expect(JSON.parse((await forwardLine(MCP_URL, "pop_k", JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }), { fetch: html.fn }))!)).toMatchObject({ id: 2, error: { message: expect.stringContaining("502") } });
    expect(JSON.parse((await forwardLine(MCP_URL, "pop_k", "not json", { fetch: html.fn }))!)).toMatchObject({ id: null, error: { code: -32700 } });
  });

  it("is launched with the key in its environment, never its arguments", () => {
    const at = extensionSrc.indexOf("cursorMcp.registerServer(");
    const call = extensionSrc.slice(at, extensionSrc.indexOf("}));", at));
    expect(call).toMatch(/args: \[context\.asAbsolutePath\("out\/proxy\.js"\)\]/);
    expect(call).toMatch(/env: \{[^}]*POPULR_KEY: key/);
    expect(call).toMatch(/POPULR_SESSION_FILE/);
  });
});

describe("extension manifest", () => {
  it("is the extension the docs name, and the download they link exists", () => {
    expect(`${manifest.publisher}.${manifest.name}`).toBe("populr.populr-seo");
    expect(docs).toContain("populr.populr-seo");
    expect(docs).toContain('href="/downloads/populr-seo.vsix"');
    // A .vsix is a zip archive.
    const vsix = readFileSync(path.join(root, "public/downloads/populr-seo.vsix"));
    expect(vsix.subarray(0, 2).toString()).toBe("PK");
    expect(vsix.length).toBeLessThan(200_000);
  });

  it("registers every command it contributes, and the docs list each one", () => {
    for (const c of manifest.contributes.commands as { command: string; title: string; category: string }[]) {
      expect(extensionSrc).toContain(`command("${c.command}"`);
      expect(docs).toContain(`${c.category}: ${c.title}`);
    }
  });

  it("registers the MCP provider under the id it declares", () => {
    const [p] = manifest.contributes.mcpServerDefinitionProviders;
    expect(extensionSrc).toContain(`PROVIDER_ID = "${p.id}"`);
  });

  it("points at Populr's server by default, and only user settings can change that", () => {
    const setting = manifest.contributes.configuration.properties["populr.serverUrl"];
    expect(setting.default).toBe(MCP_URL);
    expect(setting.scope).toBe("application");
  });

  it("supports the VS Code version its types are written against", () => {
    const types = manifest.devDependencies["@types/vscode"].replace(/^[~^]/, "");
    expect(manifest.engines.vscode).toBe(`^${types}`);
  });
});

describe("one-click install links", () => {
  it("VS Code's link opens the published Populr extension, and carries no key", async () => {
    const { VSCODE_INSTALL_URL, VSCODE_EXTENSION_ID } = await import("@/lib/mcp/install");
    expect(VSCODE_INSTALL_URL).toBe(`vscode:extension/${VSCODE_EXTENSION_ID}`);
    // The Marketplace id: the publisher is "Populr" there; ids are case-insensitive in VS Code.
    expect(VSCODE_EXTENSION_ID.toLowerCase()).toBe(`${manifest.publisher}.${manifest.name}`);
    expect(VSCODE_INSTALL_URL).not.toMatch(/pop_/);
  });

  it("Cursor's link carries the new key in base64 server config, the way Cursor decodes it", async () => {
    const { cursorInstallUrl } = await import("@/lib/mcp/install");
    const key = newKey().key;
    const url = new URL(cursorInstallUrl(key));
    expect(url.protocol).toBe("cursor:");
    expect(url.host + url.pathname).toBe("anysphere.cursor-deeplink/mcp/install");
    expect(url.searchParams.get("name")).toBe("populr");
    const config = JSON.parse(Buffer.from(url.searchParams.get("config")!, "base64").toString("utf8"));
    expect(config).toEqual({ url: MCP_URL, headers: { Authorization: `Bearer ${key}` } });
  });
});
