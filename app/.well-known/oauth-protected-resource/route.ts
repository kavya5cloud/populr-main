import { issuerFor, protectedResourceMetadata } from "@/lib/oauth/core";
import { json, preflight } from "@/lib/oauth/http";

// RFC 9728: where an MCP client learns which authorization server protects /api/mcp.
export const GET = (req?: Request) => json(protectedResourceMetadata(issuerFor(req ? new URL(req.url).origin : undefined)), 200, "public, max-age=3600");
export const OPTIONS = preflight;
