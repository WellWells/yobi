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

/** The size a PNG or JPEG header declares, read before decoding so a pixel bomb is never decoded. */
export function parseImageSize(raw: Buffer): { width: number; height: number } | null {
  if (raw.length >= 24 && raw[0] === 0x89 && raw.toString('ascii', 1, 4) === 'PNG') {
    return { width: raw.readUInt32BE(16), height: raw.readUInt32BE(20) };
  }
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
