/**
 * A picture converted, cropped or resized, for `export_file` (a WebP from a phone as a JPEG, the
 * one item the model found cut out of a photo). Electron's `nativeImage` reads PNG and JPEG only
 * (measured on Electron 44: WebP, GIF, BMP and AVIF come back empty), so the work is
 * done by Chromium in a hidden page: `createImageBitmap` reads PNG, JPEG, WebP, GIF (first frame),
 * BMP, AVIF and ICO, an `<img>` reads SVG, and `OffscreenCanvas` writes PNG, JPEG and WebP. TIFF
 * and HEIC are not read; they are refused in words the model passes on.
 *
 * The page loads nothing: every request but data: and blob: is cancelled, popups are denied,
 * navigation is stopped, downloads are refused. It is never shown: decoding and encoding need no
 * painting (the same measurement), so it is not mapped either.
 */
import { BrowserWindow, session } from 'electron';
import { SILENT_WEB_PREFERENCES, muteWindow } from '../silentWindow';

export type PictureFormat = 'png' | 'jpeg' | 'webp';

/** A rectangle in thousandths of the picture's width and height (0 = left/top edge, 1000 = right/bottom). */
export interface CropBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PictureOptions {
  format: PictureFormat;
  crop?: CropBox;
  /** The width to scale to, in pixels; the height keeps the proportions. */
  width?: number;
}

/** A picture that could not be made; the message is written for the model. */
export class PictureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PictureError';
  }
}

/** Past this a "picture" is not one a chat sends; it is refused before the page decodes it. */
export const PICTURE_MAX_BYTES = 40 * 1024 * 1024;
/** Chromium's canvas limit per side. */
export const PICTURE_MAX_SIDE = 16_384;
const PICTURE_MAX_PIXELS = 120_000_000;
const CROP_SCALE = 1_000;
const PICTURE_PARTITION = 'picture-convert';
const PICTURE_TIMEOUT_MS = 60_000;

export const PICTURE_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jfif': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
};

const MIME_OF: Readonly<Record<PictureFormat, string>> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

function cropNumbers(text: string): number[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    try {
      const value = JSON.parse(trimmed) as Record<string, unknown>;
      const keys = ['left', 'top', 'right', 'bottom'];
      return keys.every((key) => typeof value[key] === 'number' || typeof value[key] === 'string')
        ? keys.map((key) => Number(value[key]))
        : null;
    } catch {
      return null;
    }
  }
  const parts = trimmed.replace(/^\[|\]$/g, '').split(/[\s,]+/).filter(Boolean);
  return parts.map(Number);
}

/**
 * "left,top,right,bottom" in thousandths (also `[l,t,r,b]` or `{"left":…}`); all four at most 1 =
 * fractions. A string is the reason it cannot be used, for the model.
 */
export function readCropBox(text: string): CropBox | string {
  const numbers = cropNumbers(text);
  if (!numbers || numbers.length !== 4 || numbers.some((n) => !Number.isFinite(n))) {
    return '"crop" must be four numbers "left,top,right,bottom" in thousandths of the picture (0-1000).';
  }
  const scaled = numbers.every((n) => n >= 0 && n <= 1) ? numbers.map((n) => n * CROP_SCALE) : numbers;
  const [left, top, right, bottom] = scaled.map((n) => Math.min(CROP_SCALE, Math.max(0, n)));
  if (right <= left || bottom <= top) {
    return '"crop" needs right > left and bottom > top ("left,top,right,bottom" in thousandths, 0-1000).';
  }
  return { left, top, right, bottom };
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The pixels a crop box covers in a `width`×`height` picture: edges rounded outward, at least 1 pixel. */
export function cropRect(box: CropBox | undefined, width: number, height: number): PixelRect {
  if (!box) return { x: 0, y: 0, width, height };
  const x = Math.min(width - 1, Math.floor((box.left / CROP_SCALE) * width));
  const y = Math.min(height - 1, Math.floor((box.top / CROP_SCALE) * height));
  const right = Math.max(x + 1, Math.min(width, Math.ceil((box.right / CROP_SCALE) * width)));
  const bottom = Math.max(y + 1, Math.min(height, Math.ceil((box.bottom / CROP_SCALE) * height)));
  return { x, y, width: right - x, height: bottom - y };
}

/** The size written: the crop's, or scaled to `width` keeping the proportions. */
export function outputSize(rect: PixelRect, width?: number): { width: number; height: number } {
  if (!width || width === rect.width) return { width: rect.width, height: rect.height };
  return { width, height: Math.max(1, Math.round((rect.height * width) / rect.width)) };
}

function installGuard(): void {
  const ses = session.fromPartition(PICTURE_PARTITION);
  ses.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !(details.url.startsWith('data:') || details.url.startsWith('blob:')) });
  });
  ses.on('will-download', (event) => event.preventDefault());
}
let guardInstalled = false;

/*
 * Browser-side scripts (run by executeJavaScript): plain ES2017, no `??`, no imports. The first
 * decodes the picture and keeps it on the page for the second, which draws the crop and encodes it.
 */
const DECODE_SCRIPT = `(async (input) => {
  const bin = atob(input.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: input.mime });
  let source = null;
  try { source = await createImageBitmap(blob); } catch (e) { source = null; }
  if (!source) {
    source = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = URL.createObjectURL(blob);
    });
  }
  if (!source) return { error: 'unreadable' };
  window.__yobiPicture = source;
  return { width: source.naturalWidth || source.width, height: source.naturalHeight || source.height };
})`;

const ENCODE_SCRIPT = `(async (o) => {
  const canvas = new OffscreenCanvas(o.width, o.height);
  const ctx = canvas.getContext('2d');
  if (o.type === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, o.width, o.height); }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(window.__yobiPicture, o.x, o.y, o.w, o.h, 0, 0, o.width, o.height);
  const blob = await canvas.convertToBlob({ type: o.type, quality: 0.92 });
  if (blob.type !== o.type) return { error: 'encode' };
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return { data: btoa(s) };
})`;

interface Decoded { width?: number; height?: number; error?: string }
interface Encoded { data?: string; error?: string }

async function withPage<T>(work: (win: BrowserWindow) => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw new PictureError('Stopped.');
  if (!guardInstalled) {
    guardInstalled = true;
    installGuard();
  }
  const win = new BrowserWindow({
    show: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    hiddenInMissionControl: process.platform === 'darwin',
    width: 200,
    height: 200,
    webPreferences: {
      partition: PICTURE_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      ...SILENT_WEB_PREFERENCES,
    },
  });
  muteWindow(win);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const stop = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new PictureError('The picture took too long to convert.')), PICTURE_TIMEOUT_MS);
    onAbort = () => reject(new PictureError('Stopped.'));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const job = (async () => {
      await win.loadURL('data:text/html;charset=utf-8,<!doctype html><title>picture</title>');
      return work(win);
    })();
    job.catch(() => undefined);
    return await Promise.race([job, stop]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    if (!win.isDestroyed()) win.destroy();
  }
}

/** The picture `bytes` (of type `mime`) as `options.format`, cropped and scaled as asked. */
export async function convertPicture(bytes: Buffer, mime: string, options: PictureOptions, signal?: AbortSignal): Promise<{ data: Buffer; width: number; height: number }> {
  if (bytes.length > PICTURE_MAX_BYTES) throw new PictureError(`The picture is larger than ${PICTURE_MAX_BYTES / 1024 / 1024} MB.`);
  if (options.width !== undefined && (!Number.isInteger(options.width) || options.width < 1 || options.width > PICTURE_MAX_SIDE)) {
    throw new PictureError(`"width" must be a whole number of pixels from 1 to ${PICTURE_MAX_SIDE}.`);
  }
  return withPage(async (win) => {
    const input = JSON.stringify({ data: bytes.toString('base64'), mime });
    const decoded = await win.webContents.executeJavaScript(`${DECODE_SCRIPT}(${input})`, true) as Decoded;
    if (decoded.error || !decoded.width || !decoded.height) {
      throw new PictureError('This picture cannot be read (TIFF, HEIC and damaged files are not supported). Tell the user plainly; do not try another way.');
    }
    const rect = cropRect(options.crop, decoded.width, decoded.height);
    const size = outputSize(rect, options.width);
    if (size.width > PICTURE_MAX_SIDE || size.height > PICTURE_MAX_SIDE || size.width * size.height > PICTURE_MAX_PIXELS) {
      throw new PictureError(`The result would be ${size.width}×${size.height} pixels, larger than a picture can be; ask for a smaller "width".`);
    }
    const order = JSON.stringify({ ...size, x: rect.x, y: rect.y, w: rect.width, h: rect.height, type: MIME_OF[options.format] });
    const encoded = await win.webContents.executeJavaScript(`${ENCODE_SCRIPT}(${order})`, true) as Encoded;
    if (encoded.error || !encoded.data) throw new PictureError(`The picture could not be written as ${options.format.toUpperCase()}.`);
    return { data: Buffer.from(encoded.data, 'base64'), ...size };
  }, signal);
}
