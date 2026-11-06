/** What a picture's bytes say it is, whatever its name or declared type says. */
export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'gif';

export const IMAGE_FORMAT_MIMES: Record<ImageFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
} as const;

export function sniffImageFormat(raw: Buffer): ImageFormat | null {
  if (raw.length >= 8 && raw[0] === 0x89 && raw.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (raw.length >= 3 && raw[0] === 0xff && raw[1] === 0xd8 && raw[2] === 0xff) return 'jpeg';
  if (raw.length >= 12 && raw.toString('ascii', 0, 4) === 'RIFF' && raw.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (raw.length >= 6 && /^GIF8[79]a$/.test(raw.toString('ascii', 0, 6))) return 'gif';
  return null;
}

/** A WebP's size from its first chunk: lossy (`VP8 `), lossless (`VP8L`) or extended (`VP8X`). */
function webpSize(raw: Buffer): { width: number; height: number } | null {
  if (raw.length < 30 || sniffImageFormat(raw) !== 'webp') return null;
  const chunk = raw.toString('ascii', 12, 16);
  if (chunk === 'VP8 ' && raw[23] === 0x9d && raw[24] === 0x01 && raw[25] === 0x2a) {
    return { width: raw.readUInt16LE(26) & 0x3fff, height: raw.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L' && raw[20] === 0x2f) {
    const bits = raw.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') return { width: raw.readUIntLE(24, 3) + 1, height: raw.readUIntLE(27, 3) + 1 };
  return null;
}

/** width × height shrunk to fit `maxEdge` on its long side; never enlarged. */
export function fitLongEdge(width: number, height: number, maxEdge: number): [number, number] {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

/** The size a PNG, JPEG or WebP header declares, read before decoding so a pixel bomb is never decoded. */
export function parseImageSize(raw: Buffer): { width: number; height: number } | null {
  if (raw.length >= 24 && raw[0] === 0x89 && raw.toString('ascii', 1, 4) === 'PNG') {
    return { width: raw.readUInt32BE(16), height: raw.readUInt32BE(20) };
  }
  const webp = webpSize(raw);
  if (webp) return webp;
  if (raw.length >= 4 && raw[0] === 0xff && raw[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < raw.length) {
      if (raw[offset] !== 0xff) { offset++; continue; }
      const marker = raw[offset + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: raw.readUInt16BE(offset + 5), width: raw.readUInt16BE(offset + 7) };
      }
      offset += 2 + raw.readUInt16BE(offset + 2);
    }
  }
  return null;
}
