// 16-bit PCM WAV, mono, from Float32 samples. Browser-side.
//
// Browsers record in their own containers (WebM/Opus in Chrome, MP4/AAC in Safari). The
// call screen decodes each utterance and re-encodes it here, so the server only ever
// receives the one format speech-to-text was verified with.

export const TARGET_RATE = 16_000;

export function encodeWav(samples: Float32Array, sampleRate = TARGET_RATE): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

/** Root-mean-square level of a block of samples — how loud it is, 0..1. */
export function rms(samples: Float32Array | Uint8Array): number {
  let sum = 0;
  if (samples instanceof Uint8Array) {
    for (const x of samples) { const c = (x - 128) / 128; sum += c * c; }
  } else {
    for (const x of samples) sum += x * x;
  }
  return Math.sqrt(sum / Math.max(1, samples.length));
}
