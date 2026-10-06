import { describe, it, expect } from "vitest";
import { createReferenceAdapters } from "@/lib/social/adapters";
import type { SocialPlatform } from "@/lib/social/types";

// ReferenceSocialAdapter.metrics() — the deterministic fixture every platform's live
// adapter will eventually be compared against in tests. What it can express is what
// Stage 3's scoring has to survive, so the fixture itself has to stay physically
// possible — see the note in lib/social/adapters.ts.

const PLATFORMS: SocialPlatform[] = [
  "linkedin", "instagram_business", "facebook_pages", "x", "threads", "pinterest",
];

describe("metrics()", () => {
  it("is present on every reference adapter", () => {
    const adapters = createReferenceAdapters();
    for (const p of PLATFORMS) {
      expect(typeof adapters[p].metrics).toBe("function");
    }
  });

  it("never reports more engagements than impressions, across many ids", async () => {
    const adapters = createReferenceAdapters(() => 1_000);
    const adapter = adapters.linkedin;
    let successes = 0;
    for (let i = 0; i < 200; i++) {
      const snap = await adapter.metrics!(`post_${i}`, {} as any);
      if (snap.ok) {
        successes++;
        expect(snap.engagements).toBeLessThanOrEqual(snap.impressions);
      }
    }
    // Guards against the loop silently asserting nothing if every snapshot ever started
    // failing — a vacuously green test is worse than no test, because it claims coverage
    // it doesn't have.
    expect(successes).toBeGreaterThan(0);
  });

  it("is deterministic — the same externalId always reports the same thing", async () => {
    const adapters = createReferenceAdapters(() => 1_000);
    const a = await adapters.linkedin.metrics!("post_abc", {} as any);
    const b = await adapters.linkedin.metrics!("post_abc", {} as any);
    expect(a).toEqual(b);
  });

  it("reports invalid_request for a missing externalId — a caller bug, not a platform gap", async () => {
    const adapters = createReferenceAdapters(() => 1_000);
    const snap = await adapters.linkedin.metrics!("", {} as any);
    expect(snap.ok).toBe(false);
    if (!snap.ok) {
      expect(snap.reason).toBe("invalid_request");
    }
  });

  it("carries capturedAt on both the ok and the failure branch", async () => {
    const adapters = createReferenceAdapters(() => 1_000);
    const ok = await adapters.linkedin.metrics!("post_x", {} as any);
    const fail = await adapters.linkedin.metrics!("", {} as any);
    expect(ok.capturedAt).toBe(1_000);
    expect(fail.capturedAt).toBe(1_000);
  });
});