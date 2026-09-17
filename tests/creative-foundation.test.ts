import { describe, it, expect, beforeEach } from "vitest";
import {
  InMemoryStorage, VercelBlobStorage, assetKey, isValidKey, checkContent,
  storageConfigured, storage, setStorage,
} from "@/lib/creative/storage";
import {
  validateBuffer, validateStored, looksLikeMp4, mp4DurationMs,
} from "@/lib/creative/validate";
import {
  InMemoryCreativeJobRepo, idempotencyKeyFor, specHashOf, mapProviderStatus, isReady,
  CREATIVE_STATES, TERMINAL_CREATIVE_STATES, type CreativeJob,
} from "@/lib/creative/jobs";
import { prepareCreative, shotsOf } from "@/lib/creative/brief";
import { CREATIVE_LIMITS, SEEDANCE_MVP, estimateCostUsd, costPerSecondUsd } from "@/lib/creative/config";

// Phase 10A — the real-media foundation.
//
// Storage is mocked throughout: InMemoryStorage implements the same CreativeStorage
// interface as the Vercel Blob adapter, so nothing here touches a blob store or a network.

const WS = "user:alice";
const OTHER = "user:bob";

/** A minimal but structurally valid mp4: an ftyp box, then padding. */
function fakeMp4(bytes = 2048): Uint8Array {
  const b = new Uint8Array(bytes);
  b.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d], 0); // ...ftypisom
  return b;
}

function key(ws = WS, job = "job_1") {
  return assetKey(ws, job, "mp4");
}

describe("storage keys", () => {
  it("contains no caller-supplied text", () => {
    const k = assetKey("user:alice@example.com", "job_1", "mp4");
    expect(k).not.toContain("alice");
    expect(k).not.toContain("@");
    expect(k).toMatch(/^creative\/[0-9a-f]{16}\/[0-9a-f]{12}\/[0-9a-f-]{36}\.mp4$/);
  });

  it("groups a workspace together and separates different ones", () => {
    const a = assetKey(WS, "j1", "mp4").split("/")[1];
    const b = assetKey(WS, "j2", "mp4").split("/")[1];
    const c = assetKey(OTHER, "j1", "mp4").split("/")[1];
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("sanitises the extension rather than trusting it", () => {
    // Stripped of every path character and capped, so a traversal attempt survives only as
    // inert letters. The exact truncated spelling is not the point; the absence is.
    const k = assetKey(WS, "j", "../../etc/passwd");
    const ext = k.slice(k.lastIndexOf(".") + 1);
    expect(ext).toMatch(/^[a-z0-9]{1,8}$/);
    expect(k).not.toContain("..");
    expect(isValidKey(k)).toBe(true);
    expect(assetKey(WS, "j", "")).toMatch(/\.bin$/);
  });

  it("rejects keys it did not generate", () => {
    expect(isValidKey(assetKey(WS, "j", "mp4"))).toBe(true);
    for (const bad of [
      "creative/../../secret.mp4",
      "../creative/aaaaaaaaaaaaaaaa/bbbbbbbbbbbb/x.mp4",
      "creative/short/bbbbbbbbbbbb/00000000-0000-0000-0000-000000000000.mp4",
      "other/aaaaaaaaaaaaaaaa/bbbbbbbbbbbb/00000000-0000-0000-0000-000000000000.mp4",
      "",
      "https://evil.example.com/x.mp4",
      "populr://media/video/abc.mp4",
    ]) {
      expect(isValidKey(bad), bad).toBe(false);
    }
  });
});

describe("content rules", () => {
  it("accepts only the media types the engine actually stores", () => {
    expect(checkContent("video/mp4", 1000).ok).toBe(true);
    expect(checkContent("video/mp4; codecs=avc1", 1000).ok).toBe(true);
    for (const bad of ["text/html", "application/json", "image/png", "video/quicktime", ""]) {
      const r = checkContent(bad, 1000);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.reason).toContain("unsupported_media_type");
    }
  });

  it("rejects empty and oversized bodies", () => {
    expect(checkContent("video/mp4", 0)).toMatchObject({ ok: false, reason: "empty_body" });
    expect(checkContent("video/mp4", CREATIVE_LIMITS.maxAssetBytes + 1)).toMatchObject({ ok: false, reason: "too_large" });
    expect(checkContent("video/mp4", CREATIVE_LIMITS.maxAssetBytes).ok).toBe(true);
  });
});

describe("storage adapter", () => {
  let store: InMemoryStorage;
  beforeEach(() => { store = new InMemoryStorage(); });

  it("uploads, stats and reads back", async () => {
    const k = key();
    const body = fakeMp4(4096);
    const out = await store.upload({ key: k, body, contentType: "video/mp4" });
    expect(out).toMatchObject({ key: k, bytes: 4096, contentType: "video/mp4" });

    const meta = await store.stat(k);
    expect(meta).toMatchObject({ bytes: 4096, contentType: "video/mp4" });

    const stream = await store.open(k);
    expect(stream).not.toBeNull();
  });

  it("returns null rather than throwing for a missing object", async () => {
    expect(await store.stat(key())).toBeNull();
    expect(await store.open(key())).toBeNull();
  });

  it("refuses an invalid key and a disallowed type", async () => {
    await expect(store.upload({ key: "../x.mp4", body: fakeMp4(), contentType: "video/mp4" }))
      .rejects.toThrow("invalid_key");
    await expect(store.upload({ key: key(), body: fakeMp4(), contentType: "text/html" }))
      .rejects.toThrow(/unsupported_media_type/);
    expect(store.count()).toBe(0);
  });

  it("removes cleanly and is idempotent about it", async () => {
    const k = key();
    await store.upload({ key: k, body: fakeMp4(), contentType: "video/mp4" });
    await store.remove(k);
    await store.remove(k);
    expect(await store.stat(k)).toBeNull();
  });

  it("falls back to in-memory when no blob store is configured", () => {
    // Simulated rather than assumed. This used to rely on the test environment happening to
    // have no BLOB_* variables, which stopped being true the moment real credentials landed
    // in .env.local — the assertion was measuring the machine, not the code.
    const saved = { rw: process.env.BLOB_READ_WRITE_TOKEN, id: process.env.BLOB_STORE_ID };
    // storage() memoises its choice, so the cache has to be cleared on both sides of the
    // swap or the adapter picked by an earlier test would answer for this one.
    setStorage(null);
    try {
      delete process.env.BLOB_READ_WRITE_TOKEN;
      delete process.env.BLOB_STORE_ID;

      expect(storageConfigured()).toBe(false);
      expect(storage()).toBeInstanceOf(InMemoryStorage);
    } finally {
      if (saved.rw === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
      else process.env.BLOB_READ_WRITE_TOKEN = saved.rw;
      if (saved.id === undefined) delete process.env.BLOB_STORE_ID;
      else process.env.BLOB_STORE_ID = saved.id;
      setStorage(null);
    }
  });

  it("selects the real adapter when a blob store is configured", () => {
    const saved = { rw: process.env.BLOB_READ_WRITE_TOKEN, id: process.env.BLOB_STORE_ID };
    setStorage(null);
    try {
      // A placeholder value: this asserts which adapter is chosen, and never connects.
      process.env.BLOB_READ_WRITE_TOKEN = "test-token-not-a-real-credential";

      expect(storageConfigured()).toBe(true);
      expect(storage()).toBeInstanceOf(VercelBlobStorage);
    } finally {
      if (saved.rw === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
      else process.env.BLOB_READ_WRITE_TOKEN = saved.rw;
      if (saved.id === undefined) delete process.env.BLOB_STORE_ID;
      else process.env.BLOB_STORE_ID = saved.id;
      setStorage(null);
    }
  });
});

describe("media validation", () => {
  it("recognises a real mp4 header and rejects everything else", () => {
    expect(looksLikeMp4(fakeMp4())).toBe(true);
    expect(looksLikeMp4(new TextEncoder().encode("<html>error</html>"))).toBe(false);
    expect(looksLikeMp4(new Uint8Array(4))).toBe(false);
  });

  it("rejects an error page served with a video content type", () => {
    // The realistic failure: a CDN returns HTML with a 200 and the wrong header.
    const html = new TextEncoder().encode("<!doctype html><h1>500</h1>".padEnd(200, " "));
    expect(validateBuffer(html, "video/mp4")).toMatchObject({ ok: false, reason: "corrupt_or_not_mp4" });
  });

  it("rejects empty, wrong-type and oversized downloads", () => {
    expect(validateBuffer(new Uint8Array(0), "video/mp4")).toMatchObject({ ok: false, reason: "empty_file" });
    expect(validateBuffer(fakeMp4(), "application/json")).toMatchObject({ ok: false, reason: "unsupported_media_type" });
    expect(validateBuffer(fakeMp4(100), "video/mp4", { minBytes: 500 })).toMatchObject({ ok: false, reason: "too_small" });
    expect(validateBuffer(fakeMp4(2048), "video/mp4", { maxBytes: 1000 })).toMatchObject({ ok: false, reason: "too_large" });
  });

  it("accepts a well-formed file and reports only what it measured", () => {
    const r = validateBuffer(fakeMp4(4096), "video/mp4");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.facts.bytes).toBe(4096);
      expect(r.facts.contentType).toBe("video/mp4");
      // Never invented: this fixture has no mvhd box, so duration is unknown, not assumed.
      expect(r.facts.durationMs).toBeNull();
      expect(r.facts.width).toBeNull();
    }
  });

  it("returns null duration rather than guessing when there is no mvhd", () => {
    expect(mp4DurationMs(fakeMp4())).toBeNull();
  });

  it("reads a real mvhd duration when one is present", () => {
    const b = fakeMp4(256);
    const view = new DataView(b.buffer);
    const at = 64;
    b.set([0x6d, 0x76, 0x68, 0x64], at); // "mvhd"
    b[at + 4] = 0;                        // version 0
    view.setUint32(at + 16, 1000);        // timescale: 1000 ticks/sec
    view.setUint32(at + 20, 10_000);      // duration: 10,000 ticks = 10s
    expect(mp4DurationMs(b)).toBe(10_000);
  });

  it("catches a duration that does not match what was asked for", () => {
    const b = fakeMp4(256);
    const view = new DataView(b.buffer);
    const at = 64;
    b.set([0x6d, 0x76, 0x68, 0x64], at);
    b[at + 4] = 0;
    view.setUint32(at + 16, 1000);
    view.setUint32(at + 20, 30_000);      // 30s
    expect(validateBuffer(b, "video/mp4", { durationSec: 10 })).toMatchObject({ ok: false, reason: "duration_mismatch" });
    // Within tolerance, it passes.
    expect(validateBuffer(b, "video/mp4", { durationSec: 30 }).ok).toBe(true);
  });

  it("proves the asset is readable back from storage, not just written", async () => {
    const store = new InMemoryStorage();
    const k = key();
    await store.upload({ key: k, body: fakeMp4(4096), contentType: "video/mp4" });

    expect((await validateStored(store, k, { bytes: 4096, contentType: "video/mp4" })).ok).toBe(true);
    expect(await validateStored(store, k, { bytes: 9999 })).toMatchObject({ ok: false, reason: "size_mismatch" });
    expect(await validateStored(store, key(WS, "never-uploaded"))).toMatchObject({ ok: false, reason: "not_stored" });
  });
});

describe("creative job state", () => {
  it("never maps a provider success straight to ready", () => {
    // The whole invariant in one assertion: the provider finishing means the bytes are
    // still on their side, not that Populr has an asset.
    expect(mapProviderStatus("succeeded")).toBe("downloading");
    expect(mapProviderStatus("succeeded")).not.toBe("ready");
  });

  it("maps known statuses and treats unknown ones as still running", () => {
    expect(mapProviderStatus("queued")).toBe("submitted");
    expect(mapProviderStatus("running")).toBe("running");
    expect(mapProviderStatus("failed")).toBe("failed");
    expect(mapProviderStatus("cancelled")).toBe("cancelled");
    for (const unknown of ["", "processing", "PARTIALLY_DONE", "weird_new_status"]) {
      const mapped = mapProviderStatus(unknown);
      expect(mapped, unknown).toBe("running");
      expect(TERMINAL_CREATIVE_STATES, unknown).not.toContain(mapped);
    }
  });

  it("ready requires a real asset id", () => {
    const base = { status: "ready", assetId: null } as unknown as CreativeJob;
    expect(isReady(base)).toBe(false);
    expect(isReady({ ...base, assetId: "asset-1" })).toBe(true);
    expect(isReady({ ...base, status: "downloading", assetId: "asset-1" } as CreativeJob)).toBe(false);
  });

  it("has no state that means success other than ready", () => {
    expect(CREATIVE_STATES).toContain("ready");
    expect(TERMINAL_CREATIVE_STATES).toEqual(["ready", "failed", "cancelled"]);
  });
});

describe("idempotency", () => {
  let repo: InMemoryCreativeJobRepo;
  beforeEach(() => { repo = new InMemoryCreativeJobRepo(); });

  const make = (idempotencyKey: string, workspaceKey = WS) =>
    repo.create({ workspaceKey, idempotencyKey, provider: "test" });

  it("a duplicate request does not create a second job", async () => {
    const k = idempotencyKeyFor(WS, "spec-a", "nonce-1");
    const first = await make(k);
    const second = await make(k);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
  });

  it("regenerate is a new generation, not a duplicate", async () => {
    const a = idempotencyKeyFor(WS, "spec-a", "nonce-1");
    const b = idempotencyKeyFor(WS, "spec-a", "nonce-2");
    expect(a).not.toBe(b);
    expect((await make(a)).job.id).not.toBe((await make(b)).job.id);
  });

  it("different workspaces and different specs never collide", () => {
    const base = idempotencyKeyFor(WS, "spec-a", "n");
    expect(idempotencyKeyFor(OTHER, "spec-a", "n")).not.toBe(base);
    expect(idempotencyKeyFor(WS, "spec-b", "n")).not.toBe(base);
  });

  it("the spec hash is stable across key order but not across content", () => {
    expect(specHashOf({ a: 1, b: 2 })).toBe(specHashOf({ b: 2, a: 1 }));
    expect(specHashOf({ a: 1 })).not.toBe(specHashOf({ a: 2 }));
    expect(specHashOf({ d: 10 })).not.toBe(specHashOf({ d: 15 }));
  });
});

describe("workspace isolation", () => {
  it("a job cannot be read by another workspace", async () => {
    const repo = new InMemoryCreativeJobRepo();
    const { job } = await repo.create({ workspaceKey: WS, idempotencyKey: "k1", provider: "test" });
    expect(await repo.get(job.id, WS)).not.toBeNull();
    expect(await repo.get(job.id, OTHER)).toBeNull();
  });

  it("listing only returns the caller's own jobs", async () => {
    const repo = new InMemoryCreativeJobRepo();
    await repo.create({ workspaceKey: WS, idempotencyKey: "a", provider: "test" });
    await repo.create({ workspaceKey: OTHER, idempotencyKey: "b", provider: "test" });
    expect(await repo.list(WS)).toHaveLength(1);
    expect((await repo.list(WS))[0].workspaceKey).toBe(WS);
  });

  it("the sweeper sees non-terminal work and ignores finished work", async () => {
    const repo = new InMemoryCreativeJobRepo();
    const { job: running } = await repo.create({ workspaceKey: WS, idempotencyKey: "r", provider: "test" });
    const { job: done } = await repo.create({ workspaceKey: WS, idempotencyKey: "d", provider: "test" });
    await repo.update(done.id, { status: "ready", assetId: "asset-1" });

    const stale = await repo.stale(Date.now() + 60_000);
    expect(stale.map((j) => j.id)).toEqual([running.id]);
  });
});

describe("cost boundary", () => {
  it("reports no price rather than a made-up one when the rate is unset", () => {
    delete process.env.SEEDANCE_USD_PER_SECOND;
    expect(costPerSecondUsd()).toBeNull();
    expect(estimateCostUsd(10)).toBeNull();
  });

  it("computes from the configured rate when there is one", () => {
    process.env.SEEDANCE_USD_PER_SECOND = "0.03";
    expect(estimateCostUsd(10)).toBeCloseTo(0.3, 4);
    delete process.env.SEEDANCE_USD_PER_SECOND;
  });

  it("ignores a nonsense rate instead of trusting it", () => {
    for (const bad of ["abc", "-1", ""]) {
      process.env.SEEDANCE_USD_PER_SECOND = bad;
      expect(costPerSecondUsd(), bad).toBeNull();
    }
    delete process.env.SEEDANCE_USD_PER_SECOND;
  });
});

describe("creative brief adapter", () => {
  const intelligence = {
    assetType: "hero_video" as const,
    brief: {
      objective: "Launch our AI CMO", audience: "seed-stage founders",
      keyMessage: "Populr replaces the agency retainer", emotionalAngle: "calm confidence",
      proof: "nine agents running daily", cta: "start free",
      visualDirection: "clean, premium", successMetric: "signups",
    },
  };

  it("prepares a valid request through the existing intelligence layer", () => {
    const r = prepareCreative({ intelligence, durationSec: 10 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.prepared.videoSpec.modality).toBe("video");
      expect(r.prepared.durationSec).toBe(10);
      expect(r.prepared.aspectRatio).toBe("9:16");
      expect(r.prepared.specHash).toHaveLength(32);
    }
  });

  it("does not define its own storyboard type", () => {
    const r = prepareCreative({ intelligence });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const shots = shotsOf(r.prepared.spec);
      // Read straight off the existing Story → Act → Scene model.
      for (const s of shots) {
        expect(typeof s.description).toBe("string");
        expect(s.durationSec).toBeGreaterThan(0);
      }
    }
  });

  it("refuses out-of-range requests before any provider could be called", () => {
    expect(prepareCreative({ intelligence, durationSec: 2 })).toMatchObject({ ok: false, reason: "duration_out_of_range" });
    expect(prepareCreative({ intelligence, durationSec: 60 })).toMatchObject({ ok: false, reason: "duration_out_of_range" });
    expect(prepareCreative({ intelligence, durationSec: 0 })).toMatchObject({ ok: false, reason: "invalid_duration" });
    expect(prepareCreative({ intelligence, aspectRatio: "5:2" })).toMatchObject({ ok: false, reason: "unsupported_aspect_ratio" });
    expect(prepareCreative({ intelligence, resolution: "4k" })).toMatchObject({ ok: false, reason: "unsupported_resolution" });
  });

  it("treats requests differing only in duration as different generations", () => {
    const a = prepareCreative({ intelligence, durationSec: 8 });
    const b = prepareCreative({ intelligence, durationSec: 12 });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.prepared.specHash).not.toBe(b.prepared.specHash);
  });

  it("the MVP configuration matches the verified provider limits", () => {
    expect(SEEDANCE_MVP.model).toBe("dreamina-seedance-2-0-mini-260615");
    expect(SEEDANCE_MVP.minDurationSec).toBe(4);
    expect(SEEDANCE_MVP.maxDurationSec).toBe(15);
    expect(SEEDANCE_MVP.resolutions).not.toContain("1080p"); // not offered by this model
    expect(SEEDANCE_MVP.ratios).toContain("9:16");
    expect(SEEDANCE_MVP.outputUrlTtlMs).toBe(24 * 60 * 60 * 1000);
  });
});

describe("nothing user-facing was connected", () => {
  it("no synthetic locator is produced anywhere in the creative engine", async () => {
    const { readFileSync } = await import("node:fs");
    // Named explicitly: lib/creative/ predates this phase (asset-planner, council/,
    // evaluators/), and walking the directory would drag in files this phase never touched.
    for (const f of ["config.ts", "storage.ts", "validate.ts", "jobs.ts", "brief.ts"]) {
      const src = readFileSync(`lib/creative/${f}`, "utf8")
        .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
      expect(src, f).not.toContain("populr://");
    }
  });
});
