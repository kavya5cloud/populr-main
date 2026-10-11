import { describe, expect, it } from "vitest";
import { safeNext, signedInUrl } from "@/lib/auth-next";

// After signing in, people go back to the page they came from — but only a page on this site,
// so a sign-in link can't be used to send someone elsewhere.

describe("safeNext", () => {
  it("keeps a path on this site, with its query", () => {
    expect(safeNext("/app/keys")).toBe("/app/keys");
    expect(safeNext("/app/keys?tab=1")).toBe("/app/keys?tab=1");
  });

  it("falls back to the dashboard for anything that could leave the site", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "evil.example", "", null, undefined, "/app\nSet-Cookie: x", "/" + "a".repeat(300)]) {
      expect(safeNext(bad as string), String(bad)).toBe("/app");
    }
  });
});

describe("signedInUrl", () => {
  it("lands on the page with ?auth=ok", () => {
    expect(signedInUrl("https://www.trypopulr.in", "/app/keys")).toBe("https://www.trypopulr.in/app/keys?auth=ok");
    expect(signedInUrl("https://www.trypopulr.in", "/app?x=1")).toBe("https://www.trypopulr.in/app?x=1&auth=ok");
  });
});
