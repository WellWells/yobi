/**
 * Blanking a JPEG's location before it is sent.
 *
 * LINE's apps blank the GPS part of a JPEG's EXIF data before they send it, as a photo or as a file,
 * so a photo does not tell where it was taken. This does the same, and more thoroughly: LINE blanks
 * the GPS entries only, leaving the coordinates they pointed to in the file, while this also blanks
 * those values. The bytes are zeroed as the file is uploaded, so the size stays the same and the
 * file on disk is not changed.
 */
import { open } from 'node:fs/promises';

/** A span of a file, by offset and length. */
export interface ByteRange {
  off: number;
  n: number;
}

/** How much of a JPEG is read to find its EXIF data (APP1 segments, at most 64 KB each, near the start). */
const MAX_EXIF_HEAD = 256 << 10;

/** The ranges to blank in a file: its EXIF GPS data if it is a JPEG (whatever its name), else none. */
export async function jpegGPSRangesOf(path: string): Promise<ByteRange[]> {
  const fh = await open(path, 'r');
  try {
    const head = Buffer.alloc(MAX_EXIF_HEAD);
    let got = 0;
    while (got < head.length) {
      const { bytesRead } = await fh.read(head, got, head.length - got, got);
      if (bytesRead === 0) break;
      got += bytesRead;
    }
    return jpegGPSRanges(head.subarray(0, got));
  } finally {
    await fh.close();
  }
}

/**
 * In the start of a JPEG, the GPS IFD of each EXIF segment: its entry count and entries, and the
 * values stored outside them.
 */
export function jpegGPSRanges(b: Buffer): ByteRange[] {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return [];
  const out: ByteRange[] = [];
  for (let p = 2; p + 4 <= b.length;) {
    if (b[p] !== 0xff) break;
    const m = b[p + 1];
    if (m === 0xff) { // fill byte
      p++;
      continue;
    }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { // no length
      p += 2;
      continue;
    }
    if (m === 0xda || m === 0xd9) return out; // image data or end: no EXIF after this
    const size = b.readUInt16BE(p + 2);
    if (size < 2) break;
    const start = p + 4;
    const end = p + 2 + size;
    if (m === 0xe1 && end <= b.length && b.subarray(start, end).subarray(0, 6).equals(EXIF_HEADER)) {
      out.push(...tiffGPSRanges(b.subarray(start + 6, end), start + 6));
    }
    p = end;
  }
  return out;
}

const EXIF_HEADER = Buffer.from('Exif\0\0', 'latin1');

export interface ByteOrder {
  u16: (b: Buffer, at: number) => number;
  u32: (b: Buffer, at: number) => number;
}

const LITTLE: ByteOrder = { u16: (b, at) => b.readUInt16LE(at), u32: (b, at) => b.readUInt32LE(at) };
const BIG: ByteOrder = { u16: (b, at) => b.readUInt16BE(at), u32: (b, at) => b.readUInt32BE(at) };

/** The TIFF byte order of an EXIF block ("II" or "MM"), or null. */
export function tiffByteOrder(t: Buffer): ByteOrder | null {
  if (t.length < 8) return null;
  const mark = t.toString('latin1', 0, 2);
  if (mark === 'II') return LITTLE;
  if (mark === 'MM') return BIG;
  return null;
}

/** The GPS IFD in EXIF (TIFF) data that starts at `base` in the file. */
export function tiffGPSRanges(t: Buffer, base: number): ByteRange[] {
  const bo = tiffByteOrder(t);
  if (!bo || bo.u16(t, 2) !== 42) return [];
  let gps = -1;
  const ifd0 = bo.u32(t, 4);
  if (ifd0 < 8 || ifd0 + 2 > t.length) return [];
  for (let i = 0, n = bo.u16(t, ifd0); i < n; i++) {
    const e = ifd0 + 2 + 12 * i;
    if (e + 12 > t.length) break;
    if (bo.u16(t, e) === 0x8825) { // GPSInfo: the GPS IFD's offset
      gps = bo.u32(t, e + 8);
      break;
    }
  }
  if (gps < 8 || gps + 2 > t.length) return [];
  const n = Math.min(bo.u16(t, gps), Math.floor((t.length - gps - 2) / 12));
  const out: ByteRange[] = [{ off: base + gps, n: 2 + 12 * n }];
  for (let i = 0; i < n; i++) {
    const e = gps + 2 + 12 * i;
    const size = tiffTypeSize(bo.u16(t, e + 2)) * bo.u32(t, e + 4);
    if (size <= 4) continue; // the value is inside the entry
    const off = bo.u32(t, e + 8);
    if (off >= 8 && off + size <= t.length) out.push({ off: base + off, n: size });
  }
  return out;
}

/** The size of one value of a TIFF field type. */
function tiffTypeSize(typ: number): number {
  switch (typ) {
    case 1: case 2: case 6: case 7: return 1; // BYTE, ASCII, SBYTE, UNDEFINED
    case 3: case 8: return 2; // SHORT, SSHORT
    case 4: case 9: case 11: return 4; // LONG, SLONG, FLOAT
    case 5: case 10: case 12: return 8; // RATIONAL, SRATIONAL, DOUBLE
    default: return 0;
  }
}

/** Zeroes, in place, the parts of `chunk` (which starts at file offset `off`) inside `ranges`. */
export function blankRanges(chunk: Buffer, off: number, ranges: readonly ByteRange[]): void {
  for (const rg of ranges) {
    const from = Math.max(rg.off, off);
    const to = Math.min(rg.off + rg.n, off + chunk.length);
    if (from < to) chunk.fill(0, from - off, to - off);
  }
}
