import { db } from "@/lib/db";
import { createSourceRegistry, SourceRegistry } from "./sources";
import { createLiveSourceRegistry } from "./live-sources";
import { SignalAggregator } from "./aggregator";
import { ResearchService } from "./research";
import { BusinessGraphService } from "./graph";
import { OpportunityEngine } from "./opportunities";
import { InMemoryMarketMemory, NeonMarketMemory, type MarketMemoryStore } from "./memory";

// Shared market platform for the API routes: one registry + aggregator (so its cache and
// rate-limit windows are process-wide) + services. Memory persists to Neon when a database
// is configured, in-memory otherwise.

export type MarketPlatform = {
  registry: SourceRegistry;
  aggregator: SignalAggregator;
  research: ResearchService;
  graph: BusinessGraphService;
  opportunities: OpportunityEngine;
  memory: MarketMemoryStore;
};

let platform: MarketPlatform | null = null;

export function marketPlatform(): MarketPlatform {
  if (!platform) {
    // Real sources in production; the deterministic reference adapters only under test.
    //
    // Production used the reference adapters until now — offline stand-ins that generate
    // "Google Trends" and "Reddit" numbers from a hash of the topic. Those numbers went into
    // every post's context and would have gone straight to users in chat. Tests keep them
    // because a live source would make real network calls inside tests that stub fetch and
    // count every request.
    const live = process.env.NODE_ENV !== "test";
    const registry = live ? createLiveSourceRegistry(Date.now) : createSourceRegistry(Date.now);
    // One retry, not two: these are network calls on the path a person is waiting on, and a
    // source that failed twice in a row is better reported as degraded than retried again.
    const aggregator = new SignalAggregator(registry, { now: Date.now, ...(live ? { maxRetries: 1 } : {}) });
    const sql = db();
    platform = {
      registry,
      aggregator,
      research: new ResearchService({ aggregator, now: Date.now }),
      graph: new BusinessGraphService(),
      opportunities: new OpportunityEngine(),
      memory: sql ? new NeonMarketMemory(sql) : new InMemoryMarketMemory(),
    };
  }
  return platform;
}
