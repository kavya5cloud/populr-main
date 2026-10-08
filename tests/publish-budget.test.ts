import { afterEach, describe, expect, it, vi } from "vitest";
import { reclaimStalled, retryFailed, runDue, STALE_CLAIM_MS, type PublishPort } from "@/lib/automation/runner";
import { setState } from "@/lib/automation/engine";
import type { QueueItem } from "@/lib/automation/types";

// The publish pass 504'd. The loud half was the timeout; the quiet half was worse — a slot
// claimed as `publishing` when the function is killed transitions nowhere, and retryFailed
// only ever looked at `failed`. Every timeout permanently retired whatever was in flight.

const NOW = 1_000_000_000;
const slot = (over: Partial<QueueItem> = {}): QueueItem => ({
  id: "q1", tenant: "t", automationId: "a1", platform: "linkedin", source: "ai_queue",
  at: NOW - 60_000, state: "upcoming", jobId: null, order: 0, note: null, ...over,
});

describe("a claim expires", () => {
  it("returns a stranded slot to the retry path", () => {
    const stuck = slot({ state: "publishing", claimedAt: NOW - STALE_CLAIM_MS - 1 });
    const { queue, reclaimed } = reclaimStalled([stuck], { now: NOW });
    expect(reclaimed).toEqual(["q1"]);
    expect(queue[0].state).toBe("failed");
    expect(queue[0].claimedAt).toBeNull();
    // Routed through `failed` so the existing backoff and attempt cap apply, rather than a
    // second recovery path that drifts out of step with the first.
    const after = retryFailed(queue, { now: NOW + 10 * 60_000 });
    expect(after.queue[0].state).toBe("upcoming");
  });

  it("leaves a claim that is still plausibly running alone", () => {
    const live = slot({ state: "publishing", claimedAt: NOW - 30_000 });
    expect(reclaimStalled([live], { now: NOW }).reclaimed).toEqual([]);
  });

  it("treats a claim written before the field existed as stale", () => {
    // Leaving these stuck forever is the bug; one extra attempt is the cost of guessing.
    const legacy = slot({ state: "publishing" });
    expect(reclaimStalled([legacy], { now: NOW }).reclaimed).toEqual(["q1"]);
  });

  it("ignores slots that were never claimed", () => {
    for (const state of ["upcoming", "published", "failed", "cancelled"] as const) {
      expect(reclaimStalled([slot({ state })], { now: NOW }).reclaimed, state).toEqual([]);
    }
  });
});

describe("claiming stamps the time, releasing clears it", () => {
  it("records when the claim was taken", () => {
    const r = setState([slot()], "q1", "publishing");
    expect(r.ok).toBe(true);
    expect(typeof r.queue[0].claimedAt).toBe("number");
  });

  it("clears the stamp on the way out, so it describes the claim held now", () => {
    const claimed = setState([slot()], "q1", "publishing").queue;
    const done = setState(claimed, "q1", "published").queue;
    expect(done[0].claimedAt).toBeNull();
  });
});

describe("the pass yields rather than being killed", () => {
  const port = (): PublishPort => ({
    listAccounts: async () => [],
    schedule: async () => ({ id: "j", state: "scheduled" }),
  } as unknown as PublishPort);

  // The budget tests above never reach `content`, so an empty account list is fine for
  // them. The two below are about what happens AFTER content is requested, and preflight
  // fails a slot with no connected account before that — deliberately, so a tenant with
  // nothing connected never pays for a model call.
  const connected = (): PublishPort => ({
    listAccounts: async () => [{
      id: "acc_1", tenant: "t", platform: "linkedin", handle: "@populr",
      externalId: "li1", status: "connected", tokenExpiresAt: null, connectedAt: NOW,
    }],
    schedule: async () => ({ id: "j", state: "scheduled" }),
    publishNow: async () => ({ id: "job_1", state: "published", error: null }),
  } as unknown as PublishPort);

  it("stops starting slots once the budget is spent", async () => {
    // Twenty-five due slots, each needing generation, do not fit in a 60s function. Being
    // terminated mid-loop is what stranded claims in the first place.
    const queue = Array.from({ length: 25 }, (_, i) => slot({ id: `q${i}`, at: NOW - 1000 }));
    const r = await runDue(queue, "t", { now: NOW, engine: port(), budgetMs: 0, content: async () => null });
    // Budget zero: the first check trips before anything is claimed.
    expect(r.outcomes.length).toBe(0);
    expect(r.queue.every((q) => q.state === "upcoming")).toBe(true);
  });

  it("leaves unstarted slots upcoming so the next pass takes them", async () => {
    const queue = Array.from({ length: 5 }, (_, i) => slot({ id: `q${i}`, at: NOW - 1000 }));
    const r = await runDue(queue, "t", { now: NOW, engine: port(), budgetMs: 0, content: async () => null });
    expect(r.queue.filter((q) => q.state === "upcoming")).toHaveLength(5);
  });

  // The budget stops the loop STARTING a slot. It cannot interrupt one already in flight,
  // and the one step that takes tens of seconds is the model call — 45s on the shared
  // timeout, 120s for the specialist, inside a 60s function. So a single slot outlived the
  // request: killed mid-write, 504 at the gateway, claim stranded. The deadline only means
  // anything if it reaches the generation.
  it("a slot already in flight is told the deadline passed", async () => {
    let sawSignal: AbortSignal | undefined;
    const abort = new AbortController();
    const r = await runDue([slot()], "t", {
      now: NOW, engine: connected(), budgetMs: 10_000, signal: abort.signal,
      content: async () => {
        // Stand-in for the model call: it is running when the deadline passes.
        abort.abort();
        sawSignal = abort.signal;
        return null;
      },
    });
    expect(sawSignal?.aborted, "the generation never learned the pass was over").toBe(true);
    // Still `failed`, so retryFailed picks it up on the usual backoff — what changes is
    // that the queue says whose fault it was.
    expect(r.queue[0].state).toBe("failed");
    expect(r.outcomes[0].message).toMatch(/ran out of time/i);
  });

  it("a slot with genuinely no content still says so", async () => {
    // The other half of the same branch: without a deadline in play, an empty source is a
    // content problem the founder may need to act on, and must not be dressed up as ours.
    const r = await runDue([slot()], "t", {
      now: NOW, engine: connected(), budgetMs: 10_000, content: async () => null,
    });
    expect(r.queue[0].state).toBe("failed");
    expect(r.outcomes[0].message).toMatch(/no content was available/i);
  });

  // The second unbounded call. The content step got the deadline; the pre-publish rewrite
  // did not. optimize() checked `aborted` before and after its model call, but the call in
  // between ran to the provider timeout — 45s with retries and fallback — inside a 60s
  // function, so the pass still 504'd after the first fix shipped.
  describe("the pre-publish rewrite obeys the same deadline", () => {
    afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

    it("a slot whose rewrite is in flight at the deadline still finishes the pass", async () => {
      vi.stubEnv("GROQ_API_KEY", "gsk_test_groq");
      // Every provider request hangs until it is aborted — the worst case, a provider that
      // accepts the connection and never answers.
      let requests = 0;
      vi.stubGlobal("fetch", vi.fn((_u: string, init?: RequestInit) => {
        requests++;
        return new Promise((_res, rej) => {
          const s = init?.signal;
          if (s?.aborted) return rej(Object.assign(new Error("aborted"), { name: "AbortError" }));
          s?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
        });
      }));

      const abort = new AbortController();
      const started = Date.now();
      setTimeout(() => abort.abort(), 50);
      const r = await runDue([slot()], "t", {
        now: NOW, engine: connected(), budgetMs: 10_000, signal: abort.signal,
        content: async () => ({ text: "Same-day delivery for every kirana shop, starting today.", assetIds: [] }),
      });

      expect(requests, "the rewrite never reached a provider, so this proves nothing").toBeGreaterThan(0);
      // Without the signal this waits out the 45s provider timeout and the test times out.
      expect(Date.now() - started).toBeLessThan(5_000);
      // Cancelling the rewrite is not a reason to drop the post: the deterministic floor
      // stands in, and only validation may block a publish.
      expect(r.outcomes).toHaveLength(1);
    }, 15_000);
  });
});

