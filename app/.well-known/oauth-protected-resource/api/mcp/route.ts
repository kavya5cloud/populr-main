import { issuerFor, protectedResourceMetadata } from "@/lib/oauth/core";
import { json, preflight } from "@/lib/oauth/http";

// The same document at the path-specific address (RFC 9728 §3.1) clients try first.
export const GET = (req?: Request) => json(protectedResourceMetadata(issuerFor(req ? new URL(req.url).origin : undefined)), 200, "public, max-age=3600");
export const OPTIONS = preflight;
