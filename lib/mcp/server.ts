import { findTool, TOOLS, type ToolDeps } from "./tools";

// A Model Context Protocol server, over Streamable HTTP, stateless.
//
// Small enough to own rather than pull in an SDK: it speaks JSON-RPC 2.0 — initialize, ping,
// tools/list, tools/call, prompts/list, prompts/get (and empty resource lists) — responding with plain JSON (the spec
// allows JSON instead of an SSE stream when there is nothing to stream). No sessions: every
// request carries its access key, so any server instance can answer any request.

export const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
const LATEST = SUPPORTED_VERSIONS[0];

export const SERVER_INFO = { name: "populr", title: "Populr SEO", version: "1.0.0" };

const INSTRUCTIONS = [
  "Populr manages SEO for this workspace's website. The site owner approves changes in Populr; you apply them in the site's code.",
  "Start with seo_status. Use get_seo_fixes for approved titles, descriptions and structured data, and apply them in the page <head> or the framework's metadata API, replacing existing tags.",
  "After deploying, verify_page confirms the changes are live. draft_page_fix only drafts — the owner approves in Populr before it becomes a fix.",
].join(" ");

// Ready-made prompts. Clients that support MCP prompts offer these as commands (in Claude
// Code, /mcp__populr__apply_seo_fixes), so the whole workflow is one step for the user.
type PromptArg = { name: string; description: string; required: boolean };
type Prompt = { name: string; title: string; description: string; arguments: PromptArg[]; text(args: Record<string, string>): string };

export const PROMPTS: Prompt[] = [
  {
    name: "apply_seo_fixes",
    title: "Apply my Populr SEO fixes",
    description: "Apply the SEO fixes approved in Populr to this codebase, then check them once deployed.",
    arguments: [{ name: "path", description: "Only this page, e.g. /pricing. Leave empty for every page.", required: false }],
    text: ({ path }) => [
      `Apply my approved Populr SEO fixes to this codebase${path ? ` — only the page ${path}` : ""}.`,
      "1. Call seo_status to see which pages have approved fixes.",
      `2. Call get_seo_fixes${path ? ` with path "${path}"` : ""} and apply each change in the page's <head> or the framework's metadata API (for example Next.js \`export const metadata\`). Replace existing tags rather than adding duplicates.`,
      "3. Add any approved JSON-LD structured data exactly as given.",
      "4. Show me what you changed. After I deploy, call verify_page with the live URL to confirm every change is in the served HTML.",
    ].join("\n"),
  },
  {
    name: "seo_audit",
    title: "Audit a page",
    description: "Audit a live page's SEO, explain what matters most, and draft a better title and description in Populr.",
    arguments: [{ name: "url", description: "Full public URL, e.g. https://example.com/about", required: true }],
    text: ({ url }) => [
      `Audit the SEO of ${url}.`,
      "1. Call audit_page with that URL and explain the problems in order of impact.",
      "2. If the page is on the site Populr manages (check with seo_status), call draft_page_fix for its path so I can approve a better title and description in Populr.",
      "3. Don't change any code yet — tell me what you'd change first.",
    ].join("\n"),
  },
];

export type JsonRpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };
export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string } };

export const RPC = { PARSE: -32700, INVALID: -32600, METHOD: -32601, PARAMS: -32602, INTERNAL: -32603 } as const;

const ok = (id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id: id ?? null, result });
const err = (id: JsonRpcRequest["id"], code: number, message: string): JsonRpcResponse => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

export function isNotification(m: JsonRpcRequest): boolean {
  return m.id === undefined;
}

export async function handle(msg: JsonRpcRequest, workspace: string, deps: ToolDeps): Promise<JsonRpcResponse> {
  if (msg?.jsonrpc !== "2.0" || typeof msg.method !== "string") return err(msg?.id, RPC.INVALID, "Invalid JSON-RPC request");

  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return ok(msg.id, {
        protocolVersion: (SUPPORTED_VERSIONS as readonly string[]).includes(asked) ? asked : LATEST,
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, {
        tools: TOOLS.map(({ name, title, description, inputSchema, outputSchema, annotations }) => ({ name, title, description, inputSchema, outputSchema, annotations })),
      });
    case "prompts/list":
      return ok(msg.id, { prompts: PROMPTS.map(({ name, title, description, arguments: a }) => ({ name, title, description, arguments: a })) });
    case "prompts/get": {
      const prompt = PROMPTS.find((p) => p.name === String(msg.params?.name ?? ""));
      if (!prompt) return err(msg.id, RPC.PARAMS, `Unknown prompt: ${String(msg.params?.name ?? "")}`);
      const raw = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      const args: Record<string, string> = {};
      for (const a of prompt.arguments) {
        const v = typeof raw[a.name] === "string" ? String(raw[a.name]).trim().slice(0, 500) : "";
        if (a.required && !v) return err(msg.id, RPC.PARAMS, `Missing required argument: ${a.name}`);
        if (v) args[a.name] = v;
      }
      return ok(msg.id, { description: prompt.description, messages: [{ role: "user", content: { type: "text", text: prompt.text(args) } }] });
    }
    // Populr has no resources. Directories ask anyway; an empty list is a clearer answer than
    // an error.
    case "resources/list":
      return ok(msg.id, { resources: [] });
    case "resources/templates/list":
      return ok(msg.id, { resourceTemplates: [] });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const tool = findTool(name);
      if (!tool) return err(msg.id, RPC.PARAMS, `Unknown tool: ${name}`);
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      if (typeof args !== "object" || Array.isArray(args)) return err(msg.id, RPC.PARAMS, "arguments must be an object");
      for (const req of tool.inputSchema.required ?? []) {
        if (typeof args[req] !== "string" || !String(args[req]).trim()) return err(msg.id, RPC.PARAMS, `Missing required argument: ${req}`);
      }
      try {
        const r = await tool.run(workspace, args, deps);
        // Tool failures are results the model can read and react to, not protocol errors. A
        // successful result also carries structured content matching the tool's outputSchema.
        return ok(msg.id, { content: [{ type: "text", text: r.text }], ...(r.data && !r.isError ? { structuredContent: r.data } : {}), isError: !!r.isError });
      } catch {
        return ok(msg.id, { content: [{ type: "text", text: "Populr hit an error running that tool. Try again in a moment." }], isError: true });
      }
    }
    default:
      return err(msg.id, RPC.METHOD, `Method not found: ${msg.method}`);
  }
}
