import { NextRequest, NextResponse } from "next/server";
import { socialEngine } from "@/lib/social/shared";
import { automationRepo } from "@/lib/automation/shared";
import { extend, reclaimStalled, retryFailed, runDue, type PublishPort } from "@/lib/automation/runner";
import { resolveContent, type ResolvedContent } from "@/lib/automation/sources";
import { angleKeyFor, formKeyFor, topicForSlot } from "@/lib/automation/topic";
import { assistantStore } from "@/lib/assistant/shared";
import { loadCanonicalProfile } from "@/lib/services/cmo-context";
import { db } from "@/lib/db";
import { recordGeneration } from "@/lib/content/generation-log";
import { recordHeartbeat } from "@/lib/autopilot/heartbeat";
import type { Automation, QueueItem } from "@/lib/automation/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// The minute hand of automated publishing.
//
// NOT registered in vercel.json. Vercel's Hobby plan allows two cron jobs at daily
// granularity, and a once-a-day publishing cron is not a schedule — so this is driven by
// an external scheduler instead (any service that can make an authenticated GET every
// minute). On a Pro plan, add it back to vercel.json with "* * * * *" and drop the
// external trigger. Either way the endpoint is identical:
//
//   GET /api/cron/automation-publish
//   Authorization: Bearer $CRON_SECRET
//
// It is idempotent, so an overlapping or repeated call cannot double-publish.
//
// Find due slots → claim → publish through the M12 engine → record → retry what can be
// retried → extend the horizon so recurring schedules never run dry.
//
// Everything that makes this safe lives one layer down: the claim is a guarded state
// transition, and the publish carries the slot id as an idempotency key that the
// Publishing Engine de-duplicates on. This route is a loop, not a scheduler.

function authCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // Vercel signs its own cron invocations; a shared secret covers manual runs.
  if (req.headers.get("x-vercel-cron")) return true;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

/**
 * The topic an automation writes about.
 *
 * The statement the founder typed is a cadence, not a subject ("3 LinkedIn posts every
 * week"). The subject is the business itself, so the composer's own context assembly —
 * brand, website, market, memory, learning — supplies it. The statement is passed through
 * as a hint so a rule that *does* name a subject is honoured.
 */
// What to write about now lives in lib/automation/topic.ts. The old version here derived it
// from the automation's own statement by deleting numbers and cadence words, which produced
// prompts like "LinkedIn   week" and asked for the identical thing every single day.

/** How far the pass got, kept outside it so the hard stop can report it. */
type Phases = {
  startedAt: number;
  stage: "starting" | "loading tenants" | "tenants" | "dispatch" | "heartbeat" | "done";
  tenantsStarted: number;
  tenantsDoneMs?: number;
  dispatchDoneMs?: number;
};

// The time budget, end to end, inside a 60s function.
//
//   0–45s   tenants: generate and publish due slots (TENANT_DEADLINE_MS, enforced by abort)
//   45–50s  dispatch the engine's own due jobs (stops STARTING jobs at DISPATCH_UNTIL_MS)
//   54s     hard stop: answer with whatever was reached, no matter what is still running
//
// The first two were added one at a time as each slow step was found. The hard stop is the
// guarantee that does not depend on having found them all.
const TENANT_DEADLINE_MS = 45_000;
const DISPATCH_UNTIL_MS = 50_000;
const HARD_STOP_MS = 54_000;

async function runPass(phases: Phases): Promise<NextResponse> {
  const now = phases.startedAt;
  const repo = automationRepo();
  const engine = socialEngine() as unknown as PublishPort;

  const report: { tenant: string; published: number; failed: number; retried: number; extended: number }[] = [];

  // One deadline for the whole request, and the thing that enforces it.
  //
  // It was only ever advisory: checked between tenants and between slots, while the one
  // step that actually takes tens of seconds — the model call — ran to the provider's own
  // timeout. That is 45s shared and 120s for the specialist, inside a 60s function, so one
  // slot could outlive the request. The function was killed mid-flight, the gateway
  // answered 504, and the slot was left stranded in `publishing` for reclaimStalled to find.
  // Cancelling instead means the pass returns what it managed, on time.
  //
  // Declared out here so `finally` can clear the timer.
  const deadline = now + TENANT_DEADLINE_MS;
  const abort = new AbortController();
  const abortTimer = setTimeout(() => abort.abort(), Math.max(0, deadline - Date.now()));

  try {
    // No feature gate here.
    //
    // Scheduled publishing is included in the one plan, and the free month is a trial of that
    // plan, so there is nothing this could usefully check. A tier lookup that always returns
    // the same answer is worse than none: it costs a query per tenant per run and reads like a
    // rule someone has to keep in mind.
    //
    // Whether a tenant is entitled to anything at all is still decided — by accessFor, which
    // owns the trial, the grace period after a failed payment, and the period a cancelled
    // customer already paid for. That is the only question with a real answer.
    // One deadline for the whole request, not one per tenant.
    //
    // A per-tenant budget still overruns: ten tenants with forty seconds each is four
    // hundred, inside a sixty-second function. The remaining time is what each tenant gets,
    // and when it is gone the loop stops and reports how far it reached. Nothing is lost —
    // unstarted slots stay `upcoming` and the next pass is ten minutes away.
    let skippedTenants = 0;

    phases.stage = "loading tenants";
    const tenants = await repo.activeTenants();
    phases.stage = "tenants";
    for (const tenant of tenants) {
      if (Date.now() > deadline) { skippedTenants++; continue; }
      phases.tenantsStarted++;
      const automations = await repo.listAutomations(tenant);
      let queue = await repo.listQueue(tenant);

      // The goal shapes which angles get used. Absent, every angle is in play, which is
      // still far better than one prompt repeated forever.
      const settings = await assistantStore().get(tenant).catch(() => null);

      // Who this business is. Without it the daily brief read "Write a lesson learned the
      // hard way. Write it for the people you sell to." — the same seven briefs for every
      // workspace on the platform, naming nobody. The composer assembles brand voice and
      // market context on its own, but voice is how you sound, not who you are, and a post
      // that never says what the company does reads like every other post it has written.
      //
      // business_profiles is the canonical record and loadCanonicalProfile is the existing
      // reader for it; a browser-supplied profile is never trusted here.
      const sql = db();
      const profile = sql ? await loadCanonicalProfile(sql, tenant).catch(() => null) : null;
      const audience = (profile?.audience || "").trim() || "founders";

      // Recently written openings, so today is told what not to repeat. fromAiQueue saves
      // every generated post as a draft, so the drafts are the record of what has been said.
      // Cheap, and more reliable than asking a model to "be original".
      const recentTexts = (await socialEngine().listDrafts(tenant).catch(() => []))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 5)
        .map((d) => d.content.text)
        .filter(Boolean);

      // Reclaim before retrying: a slot stranded in `publishing` by a killed run is not
      // `failed` yet, so retryFailed cannot see it. Without this, every timeout silently
      // retired whatever was in flight — the loud 504 was the smaller half of that bug.
      const stalled = reclaimStalled(queue, { now });
      queue = stalled.queue;
      if (stalled.reclaimed.length) {
        console.warn(JSON.stringify({ event: "publish_reclaimed", tenant, slots: stalled.reclaimed.length }));
      }

      // Retries first: a slot whose backoff has elapsed rejoins this same run.
      const retry = retryFailed(queue, { now });
      queue = retry.queue;

      // Remember how each slot's content was produced, so Learning receives the
      // provenance alongside the outcome rather than just "something published".
      const provenance = new Map<string, ResolvedContent>();

      // Text already queued, so the pipeline can catch a duplicate before it posts twice.
      const scheduledTexts: string[] = [];

      const run = await runDue(queue, tenant, {
        now, engine,
        // Whatever is left of the request, so a slow first tenant cannot starve the rest by
        // being killed rather than yielding.
        budgetMs: Math.max(0, deadline - Date.now()),
        signal: abort.signal,
        scheduledTexts,
        onOptimized: (slotId, result) => {
          scheduledTexts.push(result.optimization.optimized.text);
          console.info(JSON.stringify({
            event: "prepublish", tenant, slot: slotId,
            source: result.optimization.source, provider: result.optimization.provider,
            applied: result.optimization.applied,
            errors: result.validation.errors.map((e) => e.code),
            warnings: result.validation.warnings.map((w) => w.code),
          }));
        },
        content: async (slot) => {
          const resolved = await resolveContent(slot, {
            // The composer already assembles brand voice, market brief and what has
            // performed (lib/content/generation-context.ts). What it never received was
            // anything that changed between one day and the next — that is this.
            topic: topicForSlot(slot, {
              goal: settings?.goal,
              product: profile?.name,
              oneLiner: profile?.oneLiner,
              audience,
              // Two do-not-repeat lists exist and they do different jobs. This one is the
              // same-run guard: several slots generate back to back, and scheduledTexts is
              // the only thing that knows what was written thirty seconds ago. The other —
              // previousCampaigns, assembled inside the composer — is the across-days
              // memory, and it cannot see a post from earlier in this same run.
              recent: [...recentTexts, ...scheduledTexts],
            }),
            audience,
            now,
            signal: abort.signal,
          });
          if (resolved) provenance.set(slot.id, resolved);

          // The angle is the reason this post says what it says. Logging it makes a run
          // reviewable — "seven posts, seven angles" is checkable; "seven posts" is not.
          console.info(JSON.stringify({
            event: "slot_topic", tenant, slot: slot.id, platform: slot.platform,
            day: new Date(slot.at).toISOString().slice(0, 10),
            angle: angleKeyFor(slot, settings?.goal),
            form: formKeyFor(slot),
            named: !!profile?.name,
            resolved: !!resolved,
          }));

          return resolved ? { text: resolved.text, assetIds: resolved.assetIds } : null;
        },
      });
      queue = run.queue;

      // Feed the Learning Engine what was published and how it was made. Correlating
      // provider, confidence and source with performance is the whole point of storing it.
      for (const o of run.outcomes) {
        const p = provenance.get(o.slotId);
        if (!p) continue;
        await recordGeneration({
          tenant, kind: "content", format: `automation:${p.origin}`,
          source: p.origin === "ai_queue" ? "llm" : "deterministic",
          provider: p.provider, model: p.model,
          confidence: p.confidence ?? 0.3, platforms: 1,
        }).catch(() => { /* metadata must never fail a publish */ });
      }

      const before = queue.length;
      queue = extend(automations, queue, now);

      await repo.saveQueue(queue);

      report.push({
        tenant,
        published: run.outcomes.filter((o) => o.ok).length,
        failed: run.outcomes.filter((o) => !o.ok).length,
        retried: retry.retried.length,
        extended: queue.length - before,
      });

      for (const o of run.outcomes) {
        console.info(JSON.stringify({ event: "automation_publish", tenant, slot: o.slotId, ok: o.ok, state: o.state, message: o.message }));
      }
    }

    // Flush the Publishing Engine's own scheduled queue in the same run, after the
    // automation slots have been claimed. Two separate every-minute crons touching the
    // same engine raced each other and doubled the cron count for no benefit; ordering
    // them in one pass means a slot created this minute also dispatches this minute.
    phases.tenantsDoneMs = Date.now() - now;
    phases.stage = "dispatch";
    let dispatched = 0;
    try {
      dispatched = (await socialEngine().dispatchDue(now, { until: now + DISPATCH_UNTIL_MS })).length;
    } catch (e) {
      console.warn(JSON.stringify({ event: "dispatch_due_failed", error: String(e).slice(0, 200) }));
    }

    // Proof the pass happened, so the app can stop taking "next post tomorrow 09:00" on
    // trust. Written after the work, not before: a heartbeat recorded on entry would go on
    // looking healthy through a pass that threw halfway.
    phases.dispatchDoneMs = Date.now() - now;
    phases.stage = "heartbeat";
    await recordHeartbeat({ at: now, dispatched, tenants: report.length });
    phases.stage = "done";

    // `skipped` is reported rather than swallowed: a pass that ran out of time looks
    // identical to a quiet one in the response body, and the workflow's own comment already
    // warns that a green run does not mean anything published.
    if (skippedTenants || abort.signal.aborted) {
      console.warn(JSON.stringify({
        event: "publish_budget_exhausted", skippedTenants, dispatched,
        // Distinct from skippedTenants: that counts tenants never started, this says a
        // generation was cut off mid-write. A pass can do one, both or neither.
        cancelled: abort.signal.aborted,
      }));
    }
    return NextResponse.json({
      ok: true, at: now, tenants: report.length, dispatched, skippedTenants,
      outOfTime: abort.signal.aborted, report,
      // Where the time went. The workflow prints this body, so a slow run explains itself
      // in its own log instead of needing someone to reproduce it.
      timing: { totalMs: Date.now() - now, tenantsMs: phases.tenantsDoneMs, dispatchMs: phases.dispatchDoneMs },
    });
  } catch (e) {
    return NextResponse.json({ error: "cron_failed", detail: String(e).slice(0, 200) }, { status: 503 });
  } finally {
    // Otherwise the timer holds the function alive to the deadline on every quiet pass —
    // most passes have nothing due and should finish in milliseconds.
    clearTimeout(abortTimer);
  }
}

/**
 * The guarantee: this endpoint answers before the platform kills it.
 *
 * The pass 504'd for days while it was fixed twice, each time by finding one more step that
 * ran past its budget — first the content model call, then the pre-publish rewrite. A third
 * was waiting in dispatch. Each fix was right and none of them made the next one
 * unnecessary, so this stops depending on having found every slow step.
 *
 * A killed function is the worst outcome: no response, no log of where it was, the queue
 * not saved, and curl retrying it twice more. Answering at 54s with `incomplete: true` and
 * the stage reached is strictly better. Anything not finished stays due — slots are
 * idempotent and a stranded claim is recovered by reclaimStalled — and the next pass is ten
 * minutes away. The workflow warns on `incomplete` rather than failing, because it is a
 * pass that ran out of time, not one that broke.
 */
export async function GET(req: NextRequest) {
  if (!authCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const phases: Phases = { startedAt: Date.now(), stage: "starting", tenantsStarted: 0 };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hardStop = new Promise<NextResponse>((resolve) => {
    timer = setTimeout(() => {
      const body = {
        ok: true, incomplete: true, stoppedAt: phases.stage,
        tenantsStarted: phases.tenantsStarted,
        timing: { totalMs: Date.now() - phases.startedAt, tenantsMs: phases.tenantsDoneMs, dispatchMs: phases.dispatchDoneMs },
      };
      console.warn(JSON.stringify({ event: "publish_hard_stop", ...body }));
      resolve(NextResponse.json(body));
    }, HARD_STOP_MS);
  });

  try {
    return await Promise.race([runPass(phases), hardStop]);
  } finally {
    clearTimeout(timer);
  }
}
