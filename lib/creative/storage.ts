import { createHash, randomUUID } from "node:crypto";
import { CREATIVE_LIMITS } from "./config";

// Creative storage — the boundary between Populr and whatever holds the bytes.
//
// The rest of the application must never import @vercel/blob. It imports CreativeStorage,
// which speaks in keys and streams, and the adapter underneath is swappable. That is the
// same shape as lib/content/registry.ts for providers and the repo pattern used by every
// store in lib/: an interface, an in-memory implementation for tests, and one real one.
//
// Why this exists at all: a media provider's output URL is a loan, not a delivery. The
// Seedance video_url is valid for 24 hours (documented), after which a "finished" asset is
// a dead link. Storage is what turns a provider response into something Populr owns.
//
// Deliberately not a file-sharing system. There is no public write path, no user-supplied
// key, and no way to ask this module to fetch an arbitrary URL — see download() below.

/** What a stored object looks like to the rest of Populr. */
export type StoredAsset = {
  /** Our key. The only handle anything outside this module should hold. */
  key: string;
  bytes: number;
  contentType: string;
};

export type StoredMeta = StoredAsset & { uploadedAt: string | null };

export type UploadInput = {
  key: string;
  body: ArrayBuffer | Uint8Array;
  contentType: string;
};

export interface CreativeStorage {
  /** Stable id for logs and the asset record. Never a vendor URL. */
  readonly id: string;
  upload(input: UploadInput): Promise<StoredAsset>;
  /** Metadata, or null when the object is not there. Never throws for "missing". */
  stat(key: string): Promise<StoredMeta | null>;
  /** Bytes, for serving through an authenticated route. null when missing. */
  open(key: string): Promise<ReadableStream<Uint8Array> | null>;
  remove(key: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/**
 * Build the storage key for a generated asset.
 *
 * The workspace key is hashed rather than written in: it is "user:<id>" or "anon:<wsid>",
 * and storage keys end up in provider dashboards, logs and support tickets. The hash still
 * groups one workspace's objects together, which is all the key needs to do — ownership is
 * decided by the media_assets row, never by parsing this string.
 *
 * Every variable part is either a hash or a UUID we generate, so there is no caller-supplied
 * text in the path at all. That is the actual defence against key injection; validateKey()
 * below is the assertion that it stayed true.
 */
export function assetKey(workspaceKey: string, jobId: string, ext: string): string {
  const ws = createHash("sha256").update(workspaceKey).digest("hex").slice(0, 16);
  const job = createHash("sha256").update(jobId).digest("hex").slice(0, 12);
  const clean = ext.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 8) || "bin";
  return `creative/${ws}/${job}/${randomUUID()}.${clean}`;
}

const KEY_RE = /^creative\/[0-9a-f]{16}\/[0-9a-f]{12}\/[0-9a-f-]{36}\.[a-z0-9]{1,8}$/;

/**
 * True only for a key this module generated.
 *
 * Checked on the way in *and* on the way out. A key arrives from the database, and the
 * database is trusted — but "trusted" is how a traversal gets through the one place that
 * would have caught it. Rejecting anything that does not match the exact shape costs a
 * regex and removes the question.
 */
export function isValidKey(key: string): boolean {
  return KEY_RE.test(key) && !key.includes("..");
}

// ---------------------------------------------------------------------------
// Content rules
// ---------------------------------------------------------------------------

export type ContentRejection = { ok: false; reason: string };
export type ContentAcceptance = { ok: true };

/** Enforced before an upload starts, so a wrong or oversized file never reaches storage. */
export function checkContent(contentType: string, bytes: number): ContentAcceptance | ContentRejection {
  const mime = contentType.split(";")[0].trim().toLowerCase();
  if (!(CREATIVE_LIMITS.allowedMimes as readonly string[]).includes(mime)) {
    return { ok: false, reason: `unsupported_media_type:${mime || "unknown"}` };
  }
  if (!Number.isFinite(bytes) || bytes <= 0) return { ok: false, reason: "empty_body" };
  if (bytes > CREATIVE_LIMITS.maxAssetBytes) return { ok: false, reason: "too_large" };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// In-memory adapter (tests, and any environment without a blob store)
// ---------------------------------------------------------------------------

export class InMemoryStorage implements CreativeStorage {
  readonly id = "memory";
  private objects = new Map<string, { body: Uint8Array; contentType: string; uploadedAt: string }>();

  async upload({ key, body, contentType }: UploadInput): Promise<StoredAsset> {
    if (!isValidKey(key)) throw new Error("invalid_key");
    const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
    const check = checkContent(contentType, bytes.byteLength);
    if (!check.ok) throw new Error(check.reason);
    this.objects.set(key, { body: bytes, contentType, uploadedAt: new Date().toISOString() });
    return { key, bytes: bytes.byteLength, contentType };
  }

  async stat(key: string): Promise<StoredMeta | null> {
    const o = this.objects.get(key);
    return o ? { key, bytes: o.body.byteLength, contentType: o.contentType, uploadedAt: o.uploadedAt } : null;
  }

  async open(key: string): Promise<ReadableStream<Uint8Array> | null> {
    const o = this.objects.get(key);
    if (!o) return null;
    return new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(o.body); c.close(); },
    });
  }

  async remove(key: string): Promise<void> { this.objects.delete(key); }

  /** Test helper. Not part of the interface. */
  count(): number { return this.objects.size; }
}

// ---------------------------------------------------------------------------
// Vercel Blob adapter
// ---------------------------------------------------------------------------

/**
 * Vercel Blob, in a private store.
 *
 * `access: "private"` matters: a public blob URL is a bearer token that never expires and
 * cannot be revoked without deleting the object. Private means the only way to the bytes is
 * open() from server code, which is what lets /api/creative/assets/[id] apply the workspace
 * check. The blob URL itself is never returned from this module for that reason — callers
 * get a key, and keys are useless without the token.
 *
 * The SDK is imported lazily so that installing the package does not drag its transport
 * into the bundle of every route that merely mentions storage, and so tests using
 * InMemoryStorage never load it at all.
 */
export class VercelBlobStorage implements CreativeStorage {
  readonly id = "vercel-blob";

  private async sdk() {
    return import("@vercel/blob");
  }

  async upload({ key, body, contentType }: UploadInput): Promise<StoredAsset> {
    if (!isValidKey(key)) throw new Error("invalid_key");
    const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
    const check = checkContent(contentType, bytes.byteLength);
    if (!check.ok) throw new Error(check.reason);

    const { put } = await this.sdk();
    // Buffer, not the raw Uint8Array: the SDK's PutBody accepts Buffer/Blob/stream, and
    // Buffer.from here is a view over the same memory rather than a copy.
    await put(key, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
      access: "private",
      contentType,
      // Our keys already carry a UUID, so a random suffix would only make the stored key
      // differ from the one in the database — and then stat() and open() could not find it.
      addRandomSuffix: false,
      // A repeated upload of the same key is a bug, not a retry: keys are unique per
      // generation. Letting it throw surfaces that instead of silently replacing an asset.
      allowOverwrite: false,
    });
    return { key, bytes: bytes.byteLength, contentType };
  }

  async stat(key: string): Promise<StoredMeta | null> {
    if (!isValidKey(key)) return null;
    const { head } = await this.sdk();
    try {
      const r = await head(key);
      return {
        key,
        bytes: r.size,
        contentType: r.contentType,
        uploadedAt: r.uploadedAt instanceof Date ? r.uploadedAt.toISOString() : null,
      };
    } catch {
      // head() throws BlobNotFoundError for a missing object. "Missing" is an answer, not a
      // failure, and every caller here is asking a yes/no question.
      return null;
    }
  }

  async open(key: string): Promise<ReadableStream<Uint8Array> | null> {
    if (!isValidKey(key)) return null;
    const { get } = await this.sdk();
    const r = await get(key, { access: "private" });
    return (r?.stream as ReadableStream<Uint8Array> | undefined) ?? null;
  }

  async remove(key: string): Promise<void> {
    if (!isValidKey(key)) return;
    const { del } = await this.sdk();
    await del(key);
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/** True when a blob store is actually configured. */
export function storageConfigured(): boolean {
  return !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

let cached: CreativeStorage | null = null;

export class StorageNotConfiguredError extends Error {
  constructor() {
    super("no blob store is configured (BLOB_READ_WRITE_TOKEN)");
    this.name = "StorageNotConfiguredError";
  }
}

/**
 * The storage the app should use.
 *
 * In production an unconfigured store throws. It would be easy to fall back to
 * InMemoryStorage everywhere and keep the app running, and that is exactly the bug: an
 * in-memory store accepts the upload, passes validation, and loses the video on the next
 * cold start — leaving a media_assets row and a "ready" job pointing at nothing. A loud
 * failure at submission time costs one error; the quiet version costs a paid generation
 * and a user being shown a video that no longer exists.
 *
 * Outside production the in-memory store stands in, so dev and tests run with no setup.
 */
export function storage(): CreativeStorage {
  if (cached) return cached;
  if (storageConfigured()) {
    cached = new VercelBlobStorage();
    return cached;
  }
  if (process.env.NODE_ENV === "production") throw new StorageNotConfiguredError();
  cached = new InMemoryStorage();
  return cached;
}

/** Tests only. */
export function setStorage(s: CreativeStorage | null): void { cached = s; }
