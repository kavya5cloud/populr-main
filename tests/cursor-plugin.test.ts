import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { MCP_URL } from "@/lib/mcp/install";
import { TOOLS } from "@/lib/mcp/tools";

// The Cursor plugin (plugins/populr-seo): it must point at the live server, ask each user for
// their own key, name only tools that exist, and never carry a key itself.

const root = path.resolve(__dirname, "..");
const dir = path.join(root, "plugins/populr-seo");
const read = (rel: string) => readFileSync(path.join(dir, rel), "utf8");
const manifest = JSON.parse(read(".cursor-plugin/plugin.json"));
const mcp = JSON.parse(read("mcp.json"));
const KEBAB = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

function files(d: string): string[] {
  return readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? files(path.join(d, f)) : [path.join(d, f)]));
}
const frontmatter = (text: string) => Object.fromEntries((text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "").split("\n").map((l) => l.split(/:\s(.*)/s).slice(0, 2)).filter(([k]) => k));

describe("Cursor plugin", () => {
  it("is listed by the repo's marketplace manifest", () => {
    const market = JSON.parse(readFileSync(path.join(root, ".cursor-plugin/marketplace.json"), "utf8"));
    const entry = market.plugins.find((p: { name: string }) => p.name === manifest.name);
    expect(entry?.source).toBe("plugins/populr-seo");
    expect(KEBAB.test(market.name) && KEBAB.test(manifest.name)).toBe(true);
    expect(statSync(path.join(dir, manifest.logo)).isFile()).toBe(true);
  });

  it("connects to the live server with the user's own key, declared as a variable", () => {
    const server = mcp.mcpServers.populr;
    expect(server.url).toBe(MCP_URL);
    expect(server.headers.Authorization).toBe("Bearer ${POPULR_KEY}");
    expect(manifest.variables.required).toContain("POPULR_KEY");
    expect(Object.keys(manifest.variables.properties)).toEqual(["POPULR_KEY"]);
  });

  it("names only tools Populr has, and every skill, rule and command has valid frontmatter", () => {
    const known = new Set(TOOLS.map((t) => t.name));
    for (const f of files(dir).filter((f) => /\.(md|mdc)$/.test(f) && !f.endsWith("README.md"))) {
      const text = readFileSync(f, "utf8");
      const fm = frontmatter(text);
      expect(fm.description, f).toBeTruthy();
      if (!f.includes("/rules/")) expect(KEBAB.test(fm.name ?? ""), `${f} name`).toBe(true);
      const named = [...text.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]);
      for (const n of named) expect(known.has(n), `${path.relative(dir, f)} mentions ${n}`).toBe(true);
    }
  });

  it("carries no access key", () => {
    for (const f of files(dir).concat(path.join(root, ".cursor-plugin/marketplace.json"))) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/pop_[A-Za-z0-9_-]{20,}/);
    }
  });
});
