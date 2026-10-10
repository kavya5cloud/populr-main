import { describe, expect, it } from "vitest";
import config from "@/next.config";

// The headers have to allow what the product does, and nothing more. Voice calls were
// broken twice over in production — the microphone was refused on our own pages, and
// default-src blocked the data: audio of every reply — while every test passed.

async function headers() {
  const all = await config.headers!();
  return Object.fromEntries(all.find((h) => h.source === "/(.*)")!.headers.map((h) => [h.key, h.value]));
}

describe("security headers", () => {
  it("let our own pages use the microphone, and nobody embedded in them", async () => {
    const pp = (await headers())["Permissions-Policy"];
    expect(pp).toContain("microphone=(self)");
    expect(pp).toContain("camera=()");
  });

  it("let the CMO's spoken replies play", async () => {
    expect((await headers())["Content-Security-Policy"]).toMatch(/media-src 'self' data: blob:/);
  });

  it("keep the protections that matter", async () => {
    const h = await headers();
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Content-Security-Policy"]).toMatch(/object-src 'none'/);
    expect(h["Content-Security-Policy"]).toMatch(/frame-ancestors 'none'/);
  });

  it("don't restrict cross-origin loading, or the SEO snippet can't run on customers' sites", async () => {
    const h = await headers();
    expect(h["Cross-Origin-Resource-Policy"]).toBeUndefined();
  });
});
