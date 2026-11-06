/**
 * A picture a flow's bot step links to (a video menu's cover) as a photo LINE PC can send. A chat
 * app shows such a link as the picture; LINE PC shows the bare address, and LINE
 * takes only JPEG and PNG as photos. So the picture is fetched — from the public web only — and
 * kept in the chat media folder: JPEG and PNG as they came, a WebP turned into a JPEG. "" when it
 * cannot be made one, and the link stays in the text. A file on this computer the bot sends as a
 * photo (a post's photos, often WebP) is made the same JPEG, or else goes as it is.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fitLongEdge, parseImageSize, sniffImageFormat } from '../imageSize';
import { readCappedBody } from '../net/cappedBody';
import { guardedFetch } from '../net/ssrfGuard';
import { webpFileAsJpeg, type WebpDecoder } from '../webpJpeg';

/** What LINE PC sends as a photo here; more is no cover. */
export const LINE_PICTURE_MAX_BYTES = 10_000_000;
const MAX_PIXELS = 40_000_000;
/** The long side a WebP is decoded to at most (covers are 1280 wide). */
const WEBP_MAX_EDGE = 1_920;
const JPEG_QUALITY = 88;
const FETCH_TIMEOUT_MS = 15_000;

export interface LinePhotoDeps {
  /** A WebP decoded to width × height as a JPEG (Electron decodes only PNG and JPEG). */
  webpToJpeg: WebpDecoder;
  /** The folder the pictures are kept in. */
  dir: () => string;
  write: (file: string, bytes: Buffer) => Promise<void>;
  onLog: (message: string) => void;
  /** After a picture was kept: the folder may be over its cap. */
  onKept?: () => void;
}

export interface LinePictureDeps extends LinePhotoDeps {
  /** The picture's bytes, at most `LINE_PICTURE_MAX_BYTES`; null when there were more. Throws when it could not be read. */
  fetchBytes: (url: string) => Promise<Buffer | null>;
}

async function isKept(file: string): Promise<boolean> {
  return fs.stat(file).then((s) => s.isFile() && s.size > 0, () => false);
}

/** The size a WebP is decoded to: its own, shrunk to fit `WEBP_MAX_EDGE`. */
export function webpTargetSize(width: number, height: number): [number, number] {
  return fitLongEdge(width, height, WEBP_MAX_EDGE);
}

/** The photo for `url`: made once per address and kept, so a menu sent again reuses it. */
export async function linePictureFile(url: string, deps: LinePictureDeps): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '';
  }
  if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.username || parsed.password) return '';
  const stem = path.join(deps.dir(), `line-picture-${createHash('sha256').update(parsed.href).digest('hex').slice(0, 16)}`);
  for (const ext of ['.jpg', '.png']) {
    if (await isKept(`${stem}${ext}`)) return `${stem}${ext}`;
  }
  try {
    const raw = await deps.fetchBytes(parsed.href);
    if (!raw) {
      deps.onLog(`[lineSelf] the picture ${parsed.host} sent is over ${LINE_PICTURE_MAX_BYTES / 1_000_000} MB — sending its link`);
      return '';
    }
    const format = sniffImageFormat(raw);
    const size = parseImageSize(raw);
    if (!format || !size || size.width <= 0 || size.height <= 0 || size.width * size.height > MAX_PIXELS) {
      deps.onLog(`[lineSelf] ${parsed.host} did not send a picture LINE can show (${format ?? 'unknown'}) — sending its link`);
      return '';
    }
    let file: string;
    let bytes = raw;
    if (format === 'jpeg') file = `${stem}.jpg`;
    else if (format === 'png') file = `${stem}.png`;
    else if (format === 'webp') {
      bytes = await deps.webpToJpeg(raw, ...webpTargetSize(size.width, size.height), JPEG_QUALITY);
      file = `${stem}.jpg`;
    } else {
      deps.onLog(`[lineSelf] ${parsed.host} sent a ${format}, which LINE does not send as a photo — sending its link`);
      return '';
    }
    await fs.mkdir(deps.dir(), { recursive: true });
    await deps.write(file, bytes);
    deps.onKept?.();
    return file;
  } catch (err: unknown) {
    deps.onLog(`[lineSelf] could not make a photo of the picture at ${parsed.host}: ${err instanceof Error ? err.message : String(err)} — sending its link`);
    return '';
  }
}

/**
 * A file on this computer as LINE PC sends it as a photo: a WebP made a JPEG kept in the chat media
 * folder (LINE sends a WebP as a bare file, outside the album), the same photo always the same file;
 * any other file itself, and so is a WebP that cannot be made one.
 */
export async function linePhotoFile(file: string, deps: LinePhotoDeps): Promise<string> {
  try {
    const jpeg = await webpFileAsJpeg(file, deps.webpToJpeg, WEBP_MAX_EDGE, JPEG_QUALITY);
    if (!jpeg) return file;
    const kept = path.join(deps.dir(), `line-photo-${createHash('sha256').update(jpeg).digest('hex').slice(0, 16)}.jpg`);
    if (await isKept(kept)) return kept;
    await fs.mkdir(deps.dir(), { recursive: true });
    await deps.write(kept, jpeg);
    deps.onKept?.();
    return kept;
  } catch (err: unknown) {
    deps.onLog(`[lineSelf] could not make ${path.basename(file)} a JPEG (${err instanceof Error ? err.message : String(err)}); sending the file as it is`);
    return file;
  }
}

/** The picture's bytes from the public web: never this computer or the local network, at every redirect. */
export async function fetchPictureBytes(url: string): Promise<Buffer | null> {
  const res = await guardedFetch(url, {
    headers: { Accept: 'image/jpeg,image/png,image/webp;q=0.9,image/*;q=0.8' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`HTTP ${res.status}`);
  }
  return readCappedBody(res, LINE_PICTURE_MAX_BYTES);
}

/** Windows' decoder and the chat media folder, loaded on first use: they pull in Electron. */
async function appPhotoDeps(onLog: (message: string) => void): Promise<LinePhotoDeps> {
  const [{ chatMediaDir, pruneChatMedia }, { webpAsJpeg }, { writeFileAtomic }] = await Promise.all([
    import('../chatMedia'),
    import('../line/lineImageCodec'),
    import('../atomicWrite'),
  ]);
  return {
    webpToJpeg: webpAsJpeg,
    dir: chatMediaDir,
    write: writeFileAtomic,
    onLog,
    onKept: () => void pruneChatMedia().catch(() => {}),
  };
}

/** `linePictureFile` with the app's own fetch, Windows' decoder and the chat media folder. */
export async function appLinePictureFile(url: string, onLog: (message: string) => void): Promise<string> {
  return linePictureFile(url, { ...(await appPhotoDeps(onLog)), fetchBytes: fetchPictureBytes });
}

/** `linePhotoFile` with Windows' decoder and the chat media folder. */
export async function appLinePhotoFile(file: string, onLog: (message: string) => void): Promise<string> {
  return linePhotoFile(file, await appPhotoDeps(onLog));
}
