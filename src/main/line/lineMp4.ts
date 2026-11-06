/**
 * Reading an MP4 (ISO base media) file for a video send: its duration (moov/mvhd) and the codec of its first video and sound
 * tracks (moov/trak/mdia/minf/stbl/stsd). Only the box headers and the moov box are read.
 */
import { open, type FileHandle } from 'node:fs/promises';
import { goQuote } from './lineGoText';

/** Bounds the metadata box read to find a video's duration. */
const MAX_MOOV_BYTES = 64 << 20;

const NOT_MP4 = 'not a readable MP4 file';

export interface Mp4Info {
  durationMs: number;
  /** Sample entry of the first video track: avc1, hvc1 … ('' for none). */
  video: string;
  /** Of the first sound track: mp4a, Opus … ('' for none). */
  audio: string;
}

/** Throws why LINE's players may not play it: not H.264 video, or sound other than AAC. */
export function mp4Playable(m: Mp4Info): void {
  if (m.video === '') throw new Error('it has no video track');
  if (m.video !== 'avc1' && m.video !== 'avc3') {
    throw new Error(`its video is ${codecName(m.video)}, not H.264, which LINE's apps convert videos to before they send them`);
  }
  if (m.audio !== '' && m.audio !== 'mp4a') {
    throw new Error(`its sound is ${codecName(m.audio)}, not AAC, which LINE's apps convert videos to before they send them`);
  }
}

const CODEC_NAMES: Readonly<Record<string, string>> = {
  hvc1: 'HEVC (H.265)',
  hev1: 'HEVC (H.265)',
  av01: 'AV1',
  vp08: 'VP8',
  vp09: 'VP9',
  mp4v: 'MPEG-4 Part 2',
  'ac-3': 'Dolby Digital (AC-3)',
  'ec-3': 'Dolby Digital Plus (E-AC-3)',
  Opus: 'Opus',
  fLaC: 'FLAC',
  '.mp3': 'MP3',
};

export function codecName(fourcc: string): string {
  return CODEC_NAMES[fourcc] ?? goQuote(fourcc);
}

async function readAt(fh: FileHandle, length: number, position: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  let got = 0;
  while (got < length) {
    const { bytesRead } = await fh.read(buf, got, length - got, position + got);
    if (bytesRead === 0) throw new Error(NOT_MP4);
    got += bytesRead;
  }
  return buf;
}

interface BoxHeader {
  type: string;
  size: number;
  hdr: number;
}

// The box at `off`: its type, total size and header size. Sizes past 2^53 are not a real file.
async function readBoxHeader(fh: FileHandle, off: number, end: number): Promise<BoxHeader> {
  const b = await readAt(fh, 8, off);
  let size = b.readUInt32BE(0);
  let hdr = 8;
  const type = b.toString('latin1', 4, 8);
  if (size === 0) size = end - off; // to the end of the file
  else if (size === 1) { // 64-bit size follows
    size = Number((await readAt(fh, 8, off + 8)).readBigUInt64BE(0));
    hdr = 16;
  }
  if (size < hdr || off + size > end) throw new Error(NOT_MP4);
  return { type, size, hdr };
}

/** Reads an MP4's duration and the codecs of its first video and sound tracks. */
export async function readMP4(path: string): Promise<Mp4Info> {
  const fh = await open(path, 'r');
  try {
    const end = (await fh.stat()).size;
    let first = true;
    for (let off = 0; off + 8 <= end;) {
      const { type, size, hdr } = await readBoxHeader(fh, off, end);
      if (first && type !== 'ftyp') throw new Error(NOT_MP4);
      first = false;
      if (type === 'moov') {
        if (size - hdr > MAX_MOOV_BYTES) throw new Error(NOT_MP4);
        return parseMoov(await readAt(fh, size - hdr, off + hdr));
      }
      off += size;
    }
    throw new Error(NOT_MP4);
  } finally {
    await fh.close();
  }
}

/** Calls fn with the type and body of each box in b, until fn returns false. */
function boxes(b: Buffer, fn: (type: string, body: Buffer) => boolean): void {
  for (let p = 0; p + 8 <= b.length;) {
    let size = b.readUInt32BE(p);
    let hdr = 8;
    if (size === 1) {
      if (p + 16 > b.length) throw new Error(NOT_MP4);
      const big = b.readBigUInt64BE(p + 8);
      size = big > BigInt(b.length - p) ? Number.MAX_SAFE_INTEGER : Number(big);
      hdr = 16;
    } else if (size === 0) {
      size = b.length - p;
    }
    if (size < hdr || size > b.length - p) throw new Error(NOT_MP4);
    if (!fn(b.toString('latin1', p + 4, p + 8), b.subarray(p + hdr, p + size))) return;
    p += size;
  }
}

/** The body of the first box of type `type` in b (empty when none). */
// A malformed box inside a track only hides that track (as line-cli does): the
// whole file is not unreadable for it.
function child(b: Buffer, type: string): Buffer {
  let out: Buffer = Buffer.alloc(0);
  try {
    boxes(b, (t, body) => {
      if (t !== type) return true;
      out = body;
      return false;
    });
  } catch {
    // keep what was found before the bad box
  }
  return out;
}

export function parseMoov(moov: Buffer): Mp4Info {
  const info: Mp4Info = { durationMs: 0, video: '', audio: '' };
  let found = false;
  let durError: Error | null = null;
  boxes(moov, (type, body) => {
    if (type === 'mvhd') {
      found = true;
      try {
        info.durationMs = mvhdDurationMs(body);
      } catch (err) {
        durError = err as Error;
      }
    } else if (type === 'trak') {
      const mdia = child(body, 'mdia');
      const hdlr = child(mdia, 'hdlr');
      const stsd = child(child(child(mdia, 'minf'), 'stbl'), 'stsd');
      if (hdlr.length < 12 || stsd.length < 16) return true;
      const entry = stsd.toString('latin1', 12, 16); // version+flags, entry count, then the first entry's size and type
      const handler = hdlr.toString('latin1', 8, 12);
      if (handler === 'vide' && info.video === '') info.video = entry;
      if (handler === 'soun' && info.audio === '') info.audio = entry;
    }
    return true;
  });
  if (!found) throw new Error(NOT_MP4);
  if (durError) throw durError;
  return info;
}

/** The duration in a movie header box's body, in milliseconds. */
export function mvhdDurationMs(b: Buffer): number {
  let scale: bigint;
  let dur: bigint;
  if (b.length >= 20 && b[0] === 0) {
    scale = BigInt(b.readUInt32BE(12));
    dur = BigInt(b.readUInt32BE(16));
  } else if (b.length >= 32 && b[0] === 1) {
    scale = BigInt(b.readUInt32BE(20));
    dur = b.readBigUInt64BE(24);
  } else {
    throw new Error(NOT_MP4);
  }
  if (scale === 0n || dur === 0n || dur === 0xffffffffn || dur === 0xffffffffffffffffn) {
    throw new Error('the MP4 file does not say how long it is');
  }
  return Number((dur * 1000n) / scale);
}
