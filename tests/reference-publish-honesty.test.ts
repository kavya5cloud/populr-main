import { afterEach, describe, expect, it, vi } from "vitest";
import { createReferenceAdapters, NOT_LIVE } from "@/lib/social/adapters";

// The reference adapter publishes nowhere. In production it reported success with a
// populr:// permalink, so posts showed "published" that no account ever displayed.

afterEach(() => { vi.unstubAllEnvs(); });

const req = { accountId: "a", content: { text: "hello" }, assets: [] } as never;
const token = { accessToken: "t", expiresAt: null } as never;

describe("a platform with no real connection", () => {
  it("fails honestly in production instead of claiming it posted", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const r = await createReferenceAdapters(() => 1).linkedin.publish(req, token);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(new RegExp(`^${NOT_LIVE}:`));
    expect(r.error).toMatch(/nothing was posted/);
  });

  it("still works as a stand-in in development and tests", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const r = await createReferenceAdapters(() => 1).linkedin.publish(req, token);
    expect(r.ok).toBe(true);
  });

  it("can be kept on deliberately for a staging demo", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SOCIAL_REFERENCE_PUBLISH", "true");
    expect((await createReferenceAdapters(() => 1).x.publish(req, token)).ok).toBe(true);
  });
});
