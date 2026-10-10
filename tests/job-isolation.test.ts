import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// One business must never see or touch another's jobs. The job routes had no check: the
// dashboard listed every business's jobs to anyone, GET /api/jobs/{id} returned a job whole —
// prompts and generated content — and cancel/pause/retry acted on it.

afterEach(() => { vi.resetModules(); vi.doUnmock("@/lib/auth"); });

async function setup() {
  vi.doMock("@/lib/auth", () => ({ getSession: async () => null }));
  const { jobEngine } = await import("@/lib/jobs/shared");
  const engine = jobEngine();
  const theirs = engine.createJob("market_research", { workspaceKey: "anon:theirs", payload: { secret: "their prompt" } } as never, { priority: "low" });
  const mine = engine.createJob("market_research", { workspaceKey: "anon:mine", payload: {} } as never, { priority: "low" });
  return { theirs, mine };
}
const get = (path: string) => new NextRequest(`http://x${path}`);
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("jobs belong to the workspace that made them", () => {
  it("another business's job reads as not found", async () => {
    const { theirs, mine } = await setup();
    const { GET } = await import("@/app/api/jobs/[id]/route");
    expect((await GET(get(`/api/jobs/${theirs.id}?wsid=mine`), params(theirs.id))).status).toBe(404);
    expect((await GET(get(`/api/jobs/${mine.id}?wsid=mine`), params(mine.id))).status).toBe(200);
    // And with no workspace at all, nothing.
    expect((await GET(get(`/api/jobs/${mine.id}`), params(mine.id))).status).toBe(404);
  });

  it("another business's job can't be cancelled, paused, resumed or retried", async () => {
    const { theirs } = await setup();
    for (const op of ["cancel", "pause", "resume", "retry"]) {
      const { POST } = await import(`@/app/api/jobs/[id]/${op}/route`);
      const res = await POST(new NextRequest(`http://x/api/jobs/${theirs.id}/${op}?wsid=mine`, { method: "POST" }), params(theirs.id));
      expect(res.status, op).toBe(404);
    }
  });

  it("the dashboard lists only the caller's jobs, and no one else's job ids", async () => {
    const { theirs, mine } = await setup();
    const { GET } = await import("@/app/api/jobs/dashboard/route");
    const body = await (await GET(get("/api/jobs/dashboard?wsid=mine"))).text();
    expect(body).toContain(mine.id);
    expect(body).not.toContain(theirs.id);
    expect((await GET(get("/api/jobs/dashboard"))).status).toBe(400);
  });
});
