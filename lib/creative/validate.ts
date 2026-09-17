import { CREATIVE_LIMITS } from "./config";
import type { CreativeStorage } from "./storage";

// Media validation.
//
// The rule this file enforces: a provider returning HTTP 200 is not evidence of a video.
// It is evidence of a response. Between "the provider said it worked" and "a person can
// play this" sit a truncated download, an HTML error page served with the wrong status, a
// zero-byte object, and a file that stored fine but is not an mp4.
//
// So validation reads the bytes. Everything below is either measured or reported as null —
// there is no field here that is inferred from what we asked the provider for. Claiming a
// 10-second video because we *requested* 10 seconds is precisely the class of lie the
// Creative Engine exists to avoid.

export type MediaFacts = {
  bytes: number;
  contentType: string;
  /** From the container, when it could be read. null means unknown, never assumed. */
  durationMs: number | null;
  width: number | null;
  height: number | null;
};

export type ValidationOk = { ok: true; facts: MediaFacts };
export type ValidationFail = { ok: false; reason: string; detail?: string };
export type Validation = ValidationOk | ValidationFail;

/** What the caller expected. Every field optional: only what is known is checked. */
export type Expectation = {
  contentType?: string;
  minBytes?: number;
  maxBytes?: number;
  /** Tolerance is generous on purpose — encoders round, and a second either way is not a fault. */
  durationSec?: number;
  durationToleranceSec?: number;
};

// ---------------------------------------------------------------------------
// Container reading
// ---------------------------------------------------------------------------

/**
 * True when the buffer really begins with an ISO base media file (mp4) header.
 *
 * Bytes 4–8 of an mp4 are the ASCII "ftyp" box type. This is a genuine structural check:
 * an HTML error page, a JSON body or a truncated-to-nothing download all fail it. It does
 * not prove the video decodes — nothing short of a decoder does — and this module does not
 * claim otherwise anywhere.
 */
export function looksLikeMp4(buf: Uint8Array): boolean {
  if (buf.byteLength < 12) return false;
  return buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70; // "ftyp"
}

/**
 * Duration in milliseconds from the mp4 `mvhd` box, or null.
 *
 * mvhd carries a timescale (ticks per second) and a duration in ticks. Scanning for the
 * box rather than walking the atom tree is a deliberate shortcut: it is a few lines instead
 * of a parser, and the failure mode is returning null, which every caller already handles.
 * A wrong answer would be worse than no answer, so the bounds checks below are strict.
 */
export function mp4DurationMs(buf: Uint8Array): number | null {
  for (let i = 0; i + 32 < buf.byteLength && i < 4_000_000; i++) {
    if (buf[i] !== 0x6d || buf[i + 1] !== 0x76 || buf[i + 2] !== 0x68 || buf[i + 3] !== 0x64) continue; // "mvhd"
    const version = buf[i + 4];
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    try {
      if (version === 0) {
        const timescale = view.getUint32(i + 16);
        const duration = view.getUint32(i + 20);
        if (!timescale || duration === 0xffffffff) return null;
        return Math.round((duration / timescale) * 1000);
      }
      if (version === 1) {
        const timescale = view.getUint32(i + 24);
        const duration = Number(view.getBigUint64(i + 28));
        if (!timescale || !Number.isFinite(duration)) return null;
        return Math.round((duration / timescale) * 1000);
      }
    } catch {
      return null;
    }
    return null;
  }
  return null;
}

/**
 * Dimensions are not read.
 *
 * They live in the `tkhd` box behind a matrix that has to be applied to get display size,
 * and getting that subtly wrong produces confident, wrong numbers on rotated video. Until
 * there is a real reason to know, this reports null and the asset record stores null. The
 * provider's own task response carries `ratio` and `resolution`, which is the right place
 * to learn this from later — and even then it is a claim to record, not a measurement.
 */
function dimensions(): { width: number | null; height: number | null } {
  return { width: null, height: null };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Validate bytes that have been downloaded but not yet stored. */
export function validateBuffer(buf: Uint8Array, contentType: string, expect: Expectation = {}): Validation {
  const mime = contentType.split(";")[0].trim().toLowerCase();

  if (buf.byteLength === 0) return { ok: false, reason: "empty_file" };
  if (!(CREATIVE_LIMITS.allowedMimes as readonly string[]).includes(mime)) {
    return { ok: false, reason: "unsupported_media_type", detail: mime || "unknown" };
  }
  if (expect.contentType && mime !== expect.contentType) {
    return { ok: false, reason: "content_type_mismatch", detail: `${mime} != ${expect.contentType}` };
  }
  if (expect.minBytes != null && buf.byteLength < expect.minBytes) {
    return { ok: false, reason: "too_small", detail: String(buf.byteLength) };
  }
  const maxBytes = expect.maxBytes ?? CREATIVE_LIMITS.maxAssetBytes;
  if (buf.byteLength > maxBytes) return { ok: false, reason: "too_large", detail: String(buf.byteLength) };

  if (mime === "video/mp4" && !looksLikeMp4(buf)) {
    // The common shape of this failure is a provider or CDN returning an error document
    // with a 200 and a video content-type. It is unreadable, and it is not a video.
    return { ok: false, reason: "corrupt_or_not_mp4" };
  }

  const durationMs = mime === "video/mp4" ? mp4DurationMs(buf) : null;
  if (expect.durationSec != null && durationMs != null) {
    const tolerance = (expect.durationToleranceSec ?? 2) * 1000;
    if (Math.abs(durationMs - expect.durationSec * 1000) > tolerance) {
      return { ok: false, reason: "duration_mismatch", detail: `${durationMs}ms != ${expect.durationSec}s` };
    }
  }

  const { width, height } = dimensions();
  return { ok: true, facts: { bytes: buf.byteLength, contentType: mime, durationMs, width, height } };
}

/**
 * Confirm an asset is genuinely retrievable from storage after it was written.
 *
 * This is the last gate before "ready", and it is separate from validateBuffer on purpose:
 * validating the bytes in memory proves we downloaded a video, not that anyone else can
 * ever fetch it again. A silent write failure looks identical to a success until the first
 * person clicks play.
 */
export async function validateStored(
  store: CreativeStorage,
  key: string,
  expect: { bytes?: number; contentType?: string } = {},
): Promise<Validation> {
  const meta = await store.stat(key);
  if (!meta) return { ok: false, reason: "not_stored", detail: key };
  if (meta.bytes <= 0) return { ok: false, reason: "empty_file" };
  if (expect.bytes != null && meta.bytes !== expect.bytes) {
    return { ok: false, reason: "size_mismatch", detail: `${meta.bytes} != ${expect.bytes}` };
  }
  const mime = meta.contentType.split(";")[0].trim().toLowerCase();
  if (expect.contentType && mime !== expect.contentType) {
    return { ok: false, reason: "content_type_mismatch", detail: `${mime} != ${expect.contentType}` };
  }
  return { ok: true, facts: { bytes: meta.bytes, contentType: mime, durationMs: null, width: null, height: null } };
}
