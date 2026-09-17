import { db } from "@/lib/db";
import { InMemoryMediaRepo, NeonMediaRepo } from "@/lib/content/media";
import { InMemoryCreativeJobRepo, NeonCreativeJobRepo, type CreativeJobRepo } from "./jobs";
import { SeedanceProvider } from "./providers/seedance";
import { storage } from "./storage";
import type { Ctx } from "./lifecycle";

// Process-wide wiring for the Creative Engine. Mirrors lib/jobs/shared.ts and
// lib/social/shared.ts: one place that decides which repository implementation is live, so
// routes never construct their own and dev/test fall back consistently.

let repo: CreativeJobRepo | null = null;

export function creativeJobs(): CreativeJobRepo {
  if (repo) return repo;
  const sql = db();
  repo = sql ? new NeonCreativeJobRepo(sql) : new InMemoryCreativeJobRepo();
  return repo;
}

/**
 * The callback the provider should call when a task finishes.
 *
 * Undefined when there is no public base url — on localhost the provider cannot reach us,
 * and registering a callback it can never deliver would leave every job waiting for a
 * webhook that will not arrive. Without it the sweeper is the only path, which is slower
 * but correct.
 */
export function seedanceCallbackUrl(): string | undefined {
  // Read from the environment rather than the request: lib/base-url derives the host from
  // request headers, and a callback URL has to be the same stable public address whether
  // it was built during a POST or by the sweeper's cron.
  const base = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  if (!base || /localhost|127\.0\.0\.1/.test(base)) return undefined;
  const secret = process.env.CRON_SECRET;
  // The callback carries a shared secret in the path because the provider does not sign its
  // callbacks (see docs/creative-engine.md). It is a weak check on its own, which is why
  // the webhook re-queries the provider rather than trusting the body it receives.
  return secret ? `${base}/api/webhooks/seedance?k=${encodeURIComponent(secret)}` : undefined;
}

export function creativeContext(): Ctx {
  const sql = db();
  return {
    jobs: creativeJobs(),
    media: sql ? new NeonMediaRepo(sql) : new InMemoryMediaRepo(),
    store: storage(),
    provider: new SeedanceProvider(seedanceCallbackUrl()),
  };
}

/** Tests only. */
export function setCreativeJobs(r: CreativeJobRepo | null): void { repo = r; }
