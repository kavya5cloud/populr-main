-- "Sign in with Populr" for the MCP server (lib/oauth): registered clients, one-time
-- authorization codes, and tokens — codes and tokens stored only as SHA-256 hashes.
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  redirect_uris JSONB NOT NULL,
  kind TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  challenge TEXT NOT NULL,
  workspace TEXT NOT NULL,
  scope TEXT NOT NULL,
  family TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS oauth_tokens (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  client_id TEXT NOT NULL,
  workspace TEXT NOT NULL,
  scope TEXT NOT NULL,
  family TEXT NOT NULL,
  granted_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  revoked_at BIGINT,
  last_used_at BIGINT
);
CREATE INDEX IF NOT EXISTS oauth_tokens_family ON oauth_tokens (family);
CREATE INDEX IF NOT EXISTS oauth_tokens_workspace ON oauth_tokens (workspace);
