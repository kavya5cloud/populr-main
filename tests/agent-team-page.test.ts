import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryTeamStateRepo } from "@/lib/agents/store";
import { emptyTeamState, type AgentTask } from "@/lib/agents/types";

// The team page's data. The daily agent pass starts a fresh launch every run, so "what has
// my team been doing" has to mean the latest state — not one the founder names, and not an
// older run that happens to come back first.

afterEach(() => { vi.resetModules(); vi.doUnmock("@/lib/auth"); vi.doUnmock("@/lib/db"); });

const task = (over: Partial<AgentTask>): AgentTask => ({
  id: "t1", tenant: "anon:ws1", launchId: "L", campaignId: "c", agent: "research", step: "research" as AgentTask["step"],
  status: "completed", task: "Found 3 rising topics", reasoning: "News coverage doubled this week",
  confidence: 0.7, outputs: ["quick commerce"], dependsOn: [], startedAt: 1_000, completedAt: 2_000,
  durationMs: 1_000, error: null, decision: null, decidedAt: null, ...over,
});

describe("latest team state", () => {
  it("returns the most recently updated launch, not the first stored", async () => {
    const repo = new InMemoryTeamStateRepo();
    await repo.save({ ...emptyTeamState("anon:ws1", "old", 100), tasks: [task({ id: "a", task: "old run" })] });
    await repo.save({ ...emptyTeamState("anon:ws1", "new", 200), tasks: [task({ id: "b", task: "today's run" })] });
    await repo.save({ ...emptyTeamState("anon:other", "x", 999), tasks: [] });   // another workspace, newer
    const s = await repo.latest("anon:ws1");
    expect(s?.launchId).toBe("new");
  });

  it("is null for a workspace whose team has never run", async () => {
    expect(await new InMemoryTeamStateRepo().latest("anon:nobody")).toBeNull();
  });
});

describe("GET /api/agents/team", () => {
  async function call(seed?: (repo: InMemoryTeamStateRepo) => Promise<void>) {
    vi.doMock("@/lib/auth", () => ({ getSession: async () => null }));
    vi.doMock("@/lib/db", async (orig) => ({ ...(await orig<object>()), db: () => null }));
    const shared = await import("@/lib/agents/shared");
    const repo = shared.teamPlatform().state as InMemoryTeamStateRepo;
    await seed?.(repo);
    const { GET } = await import("@/app/api/agents/team/route");
    const res = await GET(new NextRequest("http://x/api/agents/team?wsid=ws1"));
    return res.json();
  }

  it("says the team hasn't run, with the full roster, rather than inventing activity", async () => {
    const d = await call();
    expect(d.ran).toBe(false);
    expect(d.roster).toHaveLength(9);
    expect(d.completed).toEqual([]);
  });

  it("reports each agent's real work from the latest run", async () => {
    const d = await call(async (repo) => {
      await repo.save({ ...emptyTeamState("anon:ws1", "L", 500), tasks: [task({}), task({ id: "t2", agent: "editor", status: "failed", task: "Graded drafts", error: "timeout" })] });
    });
    expect(d.ran).toBe(true);
    const research = d.agents.find((a: { agent: string }) => a.agent === "research");
    expect(research.status).toBe("completed");
    expect(research.avgConfidence).toBe(0.7);
    expect(d.agents.find((a: { agent: string }) => a.agent === "editor").status).toBe("failed");
    expect(d.totals).toMatchObject({ completedTasks: 1, failedTasks: 1 });
    expect(d.completed.map((t: { task: string }) => t.task)).toEqual(["Found 3 rising topics"]);
  });

  it("refuses a request with no workspace", async () => {
    vi.doMock("@/lib/auth", () => ({ getSession: async () => null }));
    const { GET } = await import("@/app/api/agents/team/route");
    expect((await GET(new NextRequest("http://x/api/agents/team"))).status).toBe(400);
  });
});
