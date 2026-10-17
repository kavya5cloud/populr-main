import { authorizationServerMetadata, issuerFor } from "@/lib/oauth/core";
import { json, preflight } from "@/lib/oauth/http";

// RFC 8414: the authorization server's endpoints and what it supports.
export const GET = (req?: Request) => json(authorizationServerMetadata(issuerFor(req ? new URL(req.url).origin : undefined)), 200, "public, max-age=3600");
export const OPTIONS = preflight;
