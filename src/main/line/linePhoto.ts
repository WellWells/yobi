/**
 * Photos and videos for a file send.
 *
 * A JPEG or PNG goes as a photo with a JPEG preview (longest side 500, turned upright by its EXIF
 * orientation, transparency on white); an H.264 MP4 goes as a video with a preview of the frame
 * Windows shows for it. Decoding, scaling and JPEG encoding are the injected ImageCodec's (Electron's
 * nativeImage in the app, measured: it does not apply EXIF orientation and returns premultiplied
 * BGRA), so everything here is testable offline.
 */
import { readFile } from 'node:fs/promises';
import { tiffByteOrder } from './lineExifGps';
import { readMP4, mp4Playable } from './lineMp4';

/** The longest side of a preview, as the LINE apps make them. */
export const PREVIEW_MAX_SIDE = 500;
/** Images with more pixels than this go as files: decoding them for the preview would take too much memory. */
export const MAX_PHOTO_PIXELS = 50_000_000;
const PREVIEW_QUALITY = 85;
const VIDEO_FRAME_TIMEOUT_MS = 30_000;

/** Premultiplied BGRA pixels, rows packed (`data.length` = width × height × 4). */
export interface Bgra {
  data: Buffer;
  width: number;
  height: number;
}

export interface ImageCodec {
  /** Decodes a JPEG or PNG and scales it to width × height; null when it cannot be decoded. */
  decodeScaled: (bytes: Buffer, width: number, height: number) => Bgra | null;
  /** JPEG-encodes opaque pixels. */
  encodeJpeg: (image: Bgra, quality: number) => Buffer;
  /** The frame Windows shows for a video, scaled to fit `maxSide`; rejects when there is none. */
  videoFrame: (path: string, maxSide: number) => Promise<Bgra>;
}

/** Whether a file extension is sent as a photo. */
export function photoExt(ext: string): boolean {
  return ext === 'jpg' || ext === 'jpeg' || ext === 'png';
}

/** Whether a file extension is sent as a video message (LINE plays MP4; MOV, MKV, AVI … go as files). */
export function videoExt(ext: string): boolean {
  return ext === 'mp4' || ext === 'm4v';
}

export interface ImageInfo {
  format: 'jpeg' | 'png';
  width: number;
  height: number;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Baseline, extended and progressive: the frames Go's JPEG decoder (line-cli's) reads.
const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2]);

/** A JPEG's or PNG's format and size from its header (image.DecodeConfig); null when unreadable. */
export function imageInfo(b: Buffer): ImageInfo | null {
  if (b.length >= 24 && b.subarray(0, 8).equals(PNG_SIGNATURE)) {
    if (b.toString('latin1', 12, 16) !== 'IHDR') return null;
    return { format: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  for (let i = 2; i + 4 <= b.length;) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += marker === 0xff ? 1 : 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return null; // image data before any frame header
    const n = b.readUInt16BE(i + 2);
    if (n < 2 || i + 2 + n > b.length) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (!JPEG_SOF.has(marker) || n < 7) return null;
      return { format: 'jpeg', width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
    }
    i += 2 + n;
  }
  return null;
}

/** The EXIF orientation of a JPEG (1–8), or 1 when it has none or it cannot be read. */
export function jpegOrientation(b: Buffer): number {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return 1;
  for (let i = 2; i + 4 <= b.length;) {
    if (b[i] !== 0xff) return 1;
    const marker = b[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return 1; // image data starts: no EXIF before it
    const n = b.readUInt16BE(i + 2);
    if (n < 2 || i + 2 + n > b.length) return 1;
    const seg = b.subarray(i + 4, i + 2 + n);
    if (marker === 0xe1 && seg.length > 6 && seg.toString('latin1', 0, 6) === 'Exif\0\0') return exifOrientation(seg.subarray(6));
    i += 2 + n;
  }
  return 1;
}

/** Tag 0x0112 from IFD0 of a TIFF-format EXIF block. */
export function exifOrientation(t: Buffer): number {
  const bo = tiffByteOrder(t);
  if (!bo) return 1;
  const off = bo.u32(t, 4);
  if (off < 8 || off + 2 > t.length) return 1;
  const count = bo.u16(t, off);
  for (let k = 0; k < count; k++) {
    const e = off + 2 + 12 * k;
    if (e + 12 > t.length) return 1;
    if (bo.u16(t, e) === 0x0112 && bo.u16(t, e + 2) === 3) {
      const v = bo.u16(t, e + 8);
      return v >= 1 && v <= 8 ? v : 1;
    }
  }
  return 1;
}

/** The size a preview is scaled to: the longer side at most `maxSide`, never enlarged. */
export function previewSize(width: number, height: number, maxSide = PREVIEW_MAX_SIDE): [number, number] {
  if (width <= maxSide && height <= maxSide) return [width, height];
  if (width >= height) return [maxSide, Math.max(1, Math.trunc((height * maxSide) / width))];
  return [Math.max(1, Math.trunc((width * maxSide) / height)), maxSide];
}

/**
 * A video frame is a picture of the video, never see-through: the alpha Windows' thumbnail carries
 * is not a mask (line-cli sets it to 255 too), so treating it as one would wash the frame
 * out. In place.
 */
export function opaque(image: Bgra): Bgra {
  const d = image.data;
  for (let i = 3; i < d.length; i += 4) d[i] = 255;
  return image;
}

/** Premultiplied colour over white (c + 255 − a), in place: every pixel ends opaque. */
export function flattenOntoWhite(image: Bgra): Bgra {
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    const lift = 255 - d[i + 3];
    d[i] = Math.min(255, d[i] + lift);
    d[i + 1] = Math.min(255, d[i + 1] + lift);
    d[i + 2] = Math.min(255, d[i + 2] + lift);
    d[i + 3] = 255;
  }
  return image;
}

/** Applies an EXIF orientation (1–8) so the image displays upright. */
export function orientImage(src: Bgra, orient: number): Bgra {
  if (orient < 2 || orient > 8) return src;
  const { width: w, height: h } = src;
  const [ow, oh] = orient >= 5 ? [h, w] : [w, h];
  const out = Buffer.alloc(ow * oh * 4);
  for (let oy = 0; oy < oh; oy++) {
    for (let ox = 0; ox < ow; ox++) {
      let sx = 0;
      let sy = 0;
      switch (orient) {
        case 2: sx = w - 1 - ox; sy = oy; break;
        case 3: sx = w - 1 - ox; sy = h - 1 - oy; break;
        case 4: sx = ox; sy = h - 1 - oy; break;
        case 5: sx = oy; sy = ox; break;
        case 6: sx = oy; sy = h - 1 - ox; break;
        case 7: sx = w - 1 - oy; sy = h - 1 - ox; break;
        case 8: sx = w - 1 - oy; sy = ox; break;
      }
      src.data.copy(out, (oy * ow + ox) * 4, (sy * w + sx) * 4, (sy * w + sx) * 4 + 4);
    }
  }
  return { data: out, width: ow, height: oh };
}

export interface Photo {
  /** As displayed, after the EXIF orientation. */
  width: number;
  height: number;
  preview: Buffer;
}

/** Decodes a JPEG or PNG and makes its JPEG preview (makePhoto); throws why it cannot be a photo. */
export async function makePhoto(path: string, ext: string, codec: ImageCodec): Promise<Photo> {
  const b = await readFile(path);
  const info = imageInfo(b);
  if (!info) throw new Error('not a readable image');
  const want = ext === 'png' ? 'png' : 'jpeg';
  if (info.format !== want) throw new Error(`the content is ${info.format}, not ${want}`);
  if (info.width <= 0 || info.height <= 0 || info.width * info.height > MAX_PHOTO_PIXELS) {
    throw new Error('the image is too large to make a preview');
  }
  const [dw, dh] = previewSize(info.width, info.height);
  const small = codec.decodeScaled(b, dw, dh);
  if (!small) throw new Error('the image could not be decoded');
  const orient = info.format === 'jpeg' ? jpegOrientation(b) : 1;
  const preview = codec.encodeJpeg(orientImage(flattenOntoWhite(small), orient), PREVIEW_QUALITY);
  const [width, height] = orient >= 5 ? [info.height, info.width] : [info.width, info.height];
  return { width, height, preview };
}

export interface Video {
  durationMs: number;
  preview: Buffer;
}

/**
 * Checks that an MP4 is H.264 video with AAC sound (or none), reads its duration and makes its JPEG
 * preview from the frame Windows shows for it (makeVideo). LINE's apps convert every video to
 * H.264 MP4 before they send it, so its players are only sure to play that.
 */
export async function makeVideo(path: string, codec: ImageCodec, timeoutMs = VIDEO_FRAME_TIMEOUT_MS): Promise<Video> {
  const info = await readMP4(path);
  mp4Playable(info);
  const frame = await withTimeout(codec.videoFrame(path, PREVIEW_MAX_SIDE), timeoutMs, 'Windows did not make a preview frame in time');
  if (frame.width <= 0 || frame.height <= 0 || frame.data.length !== frame.width * frame.height * 4) {
    throw new Error('Windows returned an unreadable preview frame');
  }
  return { durationMs: info.durationMs, preview: codec.encodeJpeg(opaque(frame), PREVIEW_QUALITY) };
}

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}
