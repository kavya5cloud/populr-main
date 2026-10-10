import { findTool, TOOLS, type ToolDeps } from "./tools";

// A Model Context Protocol server, over Streamable HTTP, stateless.
//
// Small enough to own rather than pull in an SDK: it speaks JSON-RPC 2.0 and answers four
// methods — initialize, ping, tools/list, tools/call — responding with plain JSON (the spec
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
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, {
        tools: TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })),
      });
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
        // Tool failures are results the model can read and react to, not protocol errors.
        return ok(msg.id, { content: [{ type: "text", text: r.text }], isError: !!r.isError });
      } catch {
        return ok(msg.id, { content: [{ type: "text", text: "Populr hit an error running that tool. Try again in a moment." }], isError: true });
      }
    }
    default:
      return err(msg.id, RPC.METHOD, `Method not found: ${msg.method}`);
  }
}
