// An image's pixel size from the first bytes of the file — PNG, GIF, JPEG and WebP — so the
// link preview checker can say "1200×630" without downloading the whole image. Null when the
// header isn't one of these, or isn't in the bytes we have.

export type ImageSize = { width: number; height: number; format: "png" | "gif" | "jpeg" | "webp" };

export function imageSize(b: Uint8Array): ImageSize | null {
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  const u16le = (i: number) => b[i] | (b[i + 1] << 8);
  const u24le = (i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  const u32be = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const ascii = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

  if (b.length >= 24 && b[0] === 0x89 && ascii(1, 3) === "PNG" && ascii(12, 4) === "IHDR") {
    return { width: u32be(16), height: u32be(20), format: "png" };
  }
  if (b.length >= 10 && ascii(0, 3) === "GIF") return { width: u16le(6), height: u16le(8), format: "gif" };
  if (b.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4);
    if (chunk === "VP8 " && b.length >= 30) return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff, format: "webp" };
    if (chunk === "VP8L" && b.length >= 25) {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, format: "webp" };
    }
    if (chunk === "VP8X" && b.length >= 30) return { width: u24le(24) + 1, height: u24le(27) + 1, format: "webp" };
    return null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    // Walk the JPEG segments to the first start-of-frame marker; the size is in it.
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = u16be(i + 2);
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { width: u16be(i + 7), height: u16be(i + 5), format: "jpeg" };
      }
      i += 2 + len;
    }
  }
  return null;
}
