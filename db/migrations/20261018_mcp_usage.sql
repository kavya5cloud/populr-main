-- Daily counts of MCP server use (lib/mcp/usage.ts). Counts only: no keys, arguments,
-- URLs or results; the workspace is a salted one-way hash.
CREATE TABLE IF NOT EXISTS mcp_usage_daily (
  day DATE NOT NULL,
  ws TEXT NOT NULL,
  method TEXT NOT NULL,
  tool TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL,
  client TEXT NOT NULL DEFAULT '',
  calls INT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, ws, method, tool, outcome, client)
);
