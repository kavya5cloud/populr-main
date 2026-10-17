import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { acceptableRedirectUri, ACCESS_TTL_MS, MCP_RESOURCE, redirectMatches } from "@/lib/oauth/core";
import { approve, checkAuthorize, registerClient, resolveClient, revoke, token, workspaceForAccessToken } from "@/lib/oauth/service";
import { InMemoryOAuthStore } from "@/lib/oauth/store";
import { InMemoryAutopilotStore } from "@/lib/seo/autopilot-store";

// "Sign in with Populr" for the MCP server. Public clients, PKCE always, single-use codes,
// rotating refresh tokens whose reuse ends the sign-in, and an MCP server that accepts the
// resulting access token — and nothing else.

afterEach(() => { vi.resetModules(); vi.doUnmock("@/lib/oauth/store"); vi.doUnmock("@/lib/auth"); vi.doUnmock("@/lib/db"); vi.doUnmock("@/lib/seo/autopilot-store"); vi.unstubAllEnvs(); });

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};
const T0 = 1_800_000_000_000;

async function signedInGrant(store = new InMemoryOAuthStore(), workspace = "user:u1", redirect = "http://127.0.0.1:33418/callback") {
  const reg = await registerClient({ client_name: "Claude Code", redirect_uris: [redirect] }, store, T0);
  const clientId = reg.body.client_id as string;
  const { verifier, challenge } = pkce();
  const check = await checkAuthorize({ response_type: "code", client_id: clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: "S256", state: "s1", resource: MCP_RESOURCE }, store, T0);
  if (!check.ok) throw new Error("check failed");
  const back = new URL(await approve(check, workspace, store, T0));
  return { store, clientId, verifier, redirect, code: back.searchParams.get("code")!, back };
}

describe("registering a client", () => {
  it("issues a public client id", async () => {
    const r = await registerClient({ client_name: "Cursor", redirect_uris: ["cursor://anysphere.cursor-mcp/oauth/callback"], token_endpoint_auth_method: "client_secret_post" }, new InMemoryOAuthStore(), T0);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ client_name: "Cursor", token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"] });
    expect(String(r.body.client_id)).toMatch(/^pcl_/);
  });

  it("only accepts https, loopback http, or an app's own scheme", () => {
    for (const ok of ["https://vscode.dev/redirect", "http://127.0.0.1:33418/callback", "http://localhost/cb", "cursor://anysphere.cursor-mcp/oauth/callback", "vscode://x/cb"]) expect(acceptableRedirectUri(ok), ok).toBe(true);
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "http://evil.example/cb", "https://ok.example/#frag", "https://user:pw@ok.example/", "not a url"]) expect(acceptableRedirectUri(bad), bad).toBe(false);
  });

  it("refuses bad metadata", async () => {
    const s = new InMemoryOAuthStore();
    expect((await registerClient({ redirect_uris: [] }, s, T0)).status).toBe(400);
    expect((await registerClient({ redirect_uris: ["javascript:alert(1)"] }, s, T0)).body.error).toBe("invalid_redirect_uri");
    expect((await registerClient({ redirect_uris: ["https://a.example/cb"], grant_types: ["client_credentials"] }, s, T0)).body.error).toBe("invalid_client_metadata");
    expect((await registerClient({ client_name: "<script>x</script>", redirect_uris: ["https://a.example/cb"] }, s, T0)).body.client_name).toBe("scriptx/script");
  });
});

describe("the authorization request", () => {
  it("lets a loopback redirect use any port, and nothing else vary", () => {
    expect(redirectMatches(["http://127.0.0.1/callback"], "http://127.0.0.1:51234/callback")).toBe(true);
    expect(redirectMatches(["http://127.0.0.1/callback"], "http://127.0.0.1:51234/other")).toBe(false);
    expect(redirectMatches(["https://a.example/cb"], "https://a.example/cb?x=1")).toBe(false);
  });

  it("never redirects for an unknown client or an unregistered redirect", async () => {
    const s = new InMemoryOAuthStore();
    const { challenge } = pkce();
    expect(await checkAuthorize({ client_id: "pcl_nope", response_type: "code", code_challenge: challenge, code_challenge_method: "S256" }, s, T0)).toMatchObject({ ok: false, show: expect.any(String) });
    const reg = await registerClient({ redirect_uris: ["https://a.example/cb"] }, s, T0);
    expect(await checkAuthorize({ client_id: reg.body.client_id as string, redirect_uri: "https://evil.example/cb", response_type: "code", code_challenge: challenge, code_challenge_method: "S256" }, s, T0)).toMatchObject({ ok: false, show: expect.any(String) });
  });

  it("sends other mistakes back to the client, with its state", async () => {
    const s = new InMemoryOAuthStore();
    const reg = await registerClient({ redirect_uris: ["https://a.example/cb"] }, s, T0);
    const base = { client_id: reg.body.client_id as string, redirect_uri: "https://a.example/cb", response_type: "code", state: "xyz" };
    const noPkce = await checkAuthorize(base, s, T0);
    expect("redirect" in noPkce && new URL(noPkce.redirect).searchParams.get("error")).toBe("invalid_request");
    expect("redirect" in noPkce && new URL(noPkce.redirect).searchParams.get("state")).toBe("xyz");
    const plain = await checkAuthorize({ ...base, code_challenge: pkce().challenge, code_challenge_method: "plain" }, s, T0);
    expect("redirect" in plain && new URL(plain.redirect).searchParams.get("error")).toBe("invalid_request");
    const other = await checkAuthorize({ ...base, code_challenge: pkce().challenge, code_challenge_method: "S256", resource: "https://other.example/mcp" }, s, T0);
    expect("redirect" in other && new URL(other.redirect).searchParams.get("error")).toBe("invalid_target");
  });
});

describe("codes and tokens", () => {
  it("exchanges a code once, with the right verifier, for tokens the MCP server accepts", async () => {
    const g = await signedInGrant();
    expect(g.back.searchParams.get("state")).toBe("s1");
    expect(g.back.searchParams.get("iss")).toBe("https://www.trypopulr.in");

    expect((await token({ grant_type: "authorization_code", code: g.code, client_id: g.clientId, redirect_uri: g.redirect, code_verifier: pkce().verifier }, g.store, T0)).body.error).toBe("invalid_grant");
    // That attempt spent the code: a later one with the right verifier is a reuse.
    const g2 = await signedInGrant();
    const ok = await token({ grant_type: "authorization_code", code: g2.code, client_id: g2.clientId, redirect_uri: g2.redirect, code_verifier: g2.verifier, resource: MCP_RESOURCE }, g2.store, T0);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ token_type: "Bearer", expires_in: ACCESS_TTL_MS / 1000, scope: "seo" });
    expect(await workspaceForAccessToken(ok.body.access_token as string, g2.store, T0 + 1)).toBe("user:u1");
    expect(await workspaceForAccessToken(ok.body.access_token as string, g2.store, T0 + ACCESS_TTL_MS + 1)).toBeNull();
    expect(await workspaceForAccessToken("pop_not_an_oauth_token", g2.store, T0)).toBeNull();
  });

  it("revokes everything a code bought when the code is used again", async () => {
    const g = await signedInGrant();
    const first = await token({ grant_type: "authorization_code", code: g.code, client_id: g.clientId, code_verifier: g.verifier }, g.store, T0);
    expect(first.status).toBe(200);
    const again = await token({ grant_type: "authorization_code", code: g.code, client_id: g.clientId, code_verifier: g.verifier }, g.store, T0 + 10);
    expect(again.body.error).toBe("invalid_grant");
    expect(await workspaceForAccessToken(first.body.access_token as string, g.store, T0 + 20)).toBeNull();
  });

  it("refuses a code that's expired, for another client, or for another redirect", async () => {
    const g = await signedInGrant();
    expect((await token({ grant_type: "authorization_code", code: g.code, client_id: g.clientId, code_verifier: g.verifier }, g.store, T0 + 6 * 60_000)).body.error).toBe("invalid_grant");
    const h = await signedInGrant();
    expect((await token({ grant_type: "authorization_code", code: h.code, client_id: "pcl_other", code_verifier: h.verifier }, h.store, T0)).body.error).toBe("invalid_grant");
    const k = await signedInGrant();
    expect((await token({ grant_type: "authorization_code", code: k.code, client_id: k.clientId, redirect_uri: "http://127.0.0.1:1/other", code_verifier: k.verifier }, k.store, T0)).body.error).toBe("invalid_grant");
  });

  it("rotates refresh tokens, and ends the sign-in when an old one comes back", async () => {
    const g = await signedInGrant();
    const t1 = (await token({ grant_type: "authorization_code", code: g.code, client_id: g.clientId, code_verifier: g.verifier }, g.store, T0)).body;
    const t2 = (await token({ grant_type: "refresh_token", refresh_token: t1.refresh_token as string, client_id: g.clientId }, g.store, T0 + 1000)).body;
    expect(t2.access_token).toBeTruthy();
    expect(t2.refresh_token).not.toBe(t1.refresh_token);
    expect(await workspaceForAccessToken(t2.access_token as string, g.store, T0 + 2000)).toBe("user:u1");
    // The first refresh token, replayed: someone has a copy.
    expect((await token({ grant_type: "refresh_token", refresh_token: t1.refresh_token as string, client_id: g.clientId }, g.store, T0 + 3000)).body.error).toBe("invalid_grant");
    expect(await workspaceForAccessToken(t2.access_token as string, g.store, T0 + 4000)).toBeNull();
    expect((await token({ grant_type: "refresh_token", refresh_token: t2.refresh_token as string }, g.store, T0 + 5000)).body.error).toBe("invalid_grant");
  });

  it("revokes a sign-in from its refresh token", async () => {
    const g = await signedInGrant();
    const t = (await token({ grant_type: "authorization_code", code: g.code, client_id: g.clientId, code_verifier: g.verifier }, g.store, T0)).body;
    await revoke(t.refresh_token as string, g.clientId, g.store, T0 + 1);
    expect(await workspaceForAccessToken(t.access_token as string, g.store, T0 + 2)).toBeNull();
  });

  it("rejects unknown grant types", async () => {
    expect((await token({ grant_type: "password" }, new InMemoryOAuthStore(), T0)).body.error).toBe("unsupported_grant_type");
  });
});

describe("client ID metadata documents", () => {
  const url = "https://client.example/oauth/metadata.json";
  const fetcher = (doc: unknown) => (async () => ({ url, status: 200, text: JSON.stringify(doc) })) as never;

  it("uses an https client_id's own document", async () => {
    const c = await resolveClient(url, new InMemoryOAuthStore(), T0, fetcher({ client_id: url, client_name: "VS Code", redirect_uris: ["http://127.0.0.1/callback"] }));
    expect(c).toMatchObject({ clientId: url, name: "VS Code", kind: "cimd" });
  });

  it("refuses a document that names another client or a bad redirect", async () => {
    expect(await resolveClient(url, new InMemoryOAuthStore(), T0, fetcher({ client_id: "https://other.example/x", redirect_uris: ["https://a.example/cb"] }))).toBeNull();
    expect(await resolveClient(url, new InMemoryOAuthStore(), T0, fetcher({ client_id: url, redirect_uris: ["javascript:alert(1)"] }))).toBeNull();
  });
});

describe("the issuer", () => {
  it("is always the canonical address in production, whatever the request says", async () => {
    const { issuerFor, ISSUER } = await import("@/lib/oauth/core");
    vi.stubEnv("NODE_ENV", "production");
    expect(issuerFor("https://evil.example")).toBe(ISSUER);
    vi.unstubAllEnvs();
    expect(issuerFor("http://localhost:3011")).toBe("http://localhost:3011");
  });
});

describe("over HTTP", () => {
  it("publishes the metadata documents with open CORS", async () => {
    const pr = await (await import("@/app/.well-known/oauth-protected-resource/route")).GET();
    expect(await pr.json()).toMatchObject({ resource: MCP_RESOURCE, authorization_servers: ["https://www.trypopulr.in"] });
    expect(pr.headers.get("access-control-allow-origin")).toBe("*");
    const as = await (await import("@/app/.well-known/oauth-authorization-server/route")).GET();
    expect(await as.json()).toMatchObject({ code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], registration_endpoint: "https://www.trypopulr.in/api/oauth/register" });
    const path = await (await import("@/app/.well-known/oauth-protected-resource/api/mcp/route")).GET();
    expect((await path.json()).resource).toBe(MCP_RESOURCE);
  });

  it("only takes Allow from Populr's own page, and needs a signed-in account", async () => {
    const store = new InMemoryOAuthStore();
    vi.doMock("@/lib/oauth/store", async (orig) => ({ ...(await orig<object>()), oauthStore: () => store }));
    vi.doMock("@/lib/db", async (orig) => ({ ...(await orig<object>()), db: () => (() => []) as unknown }));
    vi.doMock("@/lib/auth", async (orig) => ({ ...(await orig<object>()), getSession: async () => null }));
    const reg = await registerClient({ redirect_uris: ["https://a.example/cb"] }, store, Date.now());
    const params = { response_type: "code", client_id: reg.body.client_id as string, redirect_uri: "https://a.example/cb", code_challenge: pkce().challenge, code_challenge_method: "S256", state: "z" };
    const { POST } = await import("@/app/api/oauth/authorize/route");
    const post = (origin: string, decision: string) => POST(new NextRequest("http://x/api/oauth/authorize", { method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify({ params, decision }) }));
    expect((await post("https://evil.example", "allow")).status).toBe(403);
    expect((await post("http://x", "allow")).status).toBe(401);
    const denied = await (await post("http://x", "deny")).json();
    expect(new URL(denied.redirect).searchParams.get("error")).toBe("access_denied");
  });

  it("goes from registration to a tool call, and stops when the app is disconnected", async () => {
    const store = new InMemoryOAuthStore();
    vi.doMock("@/lib/oauth/store", async (orig) => ({ ...(await orig<object>()), oauthStore: () => store }));
    vi.doMock("@/lib/db", async (orig) => ({ ...(await orig<object>()), db: () => (() => []) as unknown }));
    vi.doMock("@/lib/auth", async (orig) => ({ ...(await orig<object>()), getSession: async () => ({ userId: "u7", email: "dev@example.com" }) }));
    vi.doMock("@/lib/seo/autopilot-store", async (orig) => ({ ...(await orig<object>()), autopilotStore: () => new InMemoryAutopilotStore() }));

    const register = (await import("@/app/api/oauth/register/route")).POST;
    const reg = await (await register(new NextRequest("http://x/api/oauth/register", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.70" }, body: JSON.stringify({ client_name: "Claude Code", redirect_uris: ["http://127.0.0.1/callback"] }) }))).json();
    const { verifier, challenge } = pkce();
    const allow = (await import("@/app/api/oauth/authorize/route")).POST;
    // Outside production the issuer (and so the resource) is the request's own origin.
    const params = { response_type: "code", client_id: reg.client_id, redirect_uri: "http://127.0.0.1:41000/callback", code_challenge: challenge, code_challenge_method: "S256", state: "abc", resource: "http://x/api/mcp" };
    const approved = await (await allow(new NextRequest("http://x/api/oauth/authorize", { method: "POST", headers: { "Content-Type": "application/json", origin: "http://x" }, body: JSON.stringify({ params, decision: "allow" }) }))).json();
    const code = new URL(approved.redirect).searchParams.get("code")!;

    const tokenRoute = (await import("@/app/api/oauth/token/route")).POST;
    const tok = await (await tokenRoute(new NextRequest("http://x/api/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "x-forwarded-for": "203.0.113.71" }, body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: reg.client_id, redirect_uri: params.redirect_uri, code_verifier: verifier }).toString() }))).json();
    expect(tok.access_token).toMatch(/^poa_/);

    const mcp = (await import("@/app/api/mcp/route")).POST;
    const call = (bearer: string) => mcp(new NextRequest("http://x/api/mcp", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}`, "x-forwarded-for": "203.0.113.72" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "seo_status", arguments: {} } }) }));
    const res = await call(tok.access_token);
    expect(res.status).toBe(200);
    expect((await res.json()).result.structuredContent.status).toBe("not_set_up");

    const grants = (await import("@/app/api/oauth/grants/route"));
    const list = await (await grants.GET(new NextRequest("http://x/api/oauth/grants"))).json();
    expect(list.apps).toEqual([expect.objectContaining({ clientName: "Claude Code" })]);
    expect((await grants.DELETE(new NextRequest(`http://x/api/oauth/grants?family=${list.apps[0].family}`, { method: "DELETE", headers: { origin: "http://x" } }))).status).toBe(200);

    const after = await call(tok.access_token);
    expect(after.status).toBe(401);
    expect(after.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });
});
