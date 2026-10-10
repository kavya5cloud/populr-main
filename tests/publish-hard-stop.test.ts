import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The publish pass 504'd for days and was fixed twice, each time by finding one more step
// that overran its budget. These pin the guarantee that does not depend on finding them all:
// whatever hangs, the endpoint answers before the platform kills the function.

const hang = () => new Promise<never>(() => {});

function request() {
  return new NextRequest("https://www.trypopulr.in/api/cron/automation-publish", {
    headers: { authorization: "Bearer test-secret" },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock("@/lib/automation/shared");
  vi.doUnmock("@/lib/social/shared");
});

describe("the publish endpoint always answers", () => {
  it("returns at the hard stop, naming the stage that hung", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    // The worst case: the very first read never comes back.
    vi.doMock("@/lib/automation/shared", () => ({ automationRepo: () => ({ activeTenants: hang }) }));
    vi.doMock("@/lib/social/shared", () => ({ socialEngine: () => ({}) }));
    vi.useFakeTimers();

    const { GET } = await import("@/app/api/cron/automation-publish/route");
    const pending = GET(request());
    await vi.advanceTimersByTimeAsync(54_000);
    const res = await pending;

    // 200, not 504: the gateway never got the chance to time it out.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.incomplete).toBe(true);
    // The point of answering instead of dying: the log now says WHERE.
    expect(body.stoppedAt).toBe("loading tenants");
    expect(body.timing.totalMs).toBeGreaterThanOrEqual(54_000);
  });

  it("does not answer early while there is still time", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    vi.doMock("@/lib/automation/shared", () => ({ automationRepo: () => ({ activeTenants: hang }) }));
    vi.doMock("@/lib/social/shared", () => ({ socialEngine: () => ({}) }));
    vi.useFakeTimers();

    const { GET } = await import("@/app/api/cron/automation-publish/route");
    let settled = false;
    void GET(request()).then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(53_000);
    expect(settled, "gave up on a pass that still had time").toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(settled).toBe(true);
  });

  it("still refuses a caller without the secret, before doing anything", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    const { GET } = await import("@/app/api/cron/automation-publish/route");
    const res = await GET(new NextRequest("https://www.trypopulr.in/api/cron/automation-publish"));
    expect(res.status).toBe(401);
  });
});
