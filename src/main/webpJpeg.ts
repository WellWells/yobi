/**
 * A WebP file made a JPEG. Chat apps send JPEG (and PNG) as photos — Telegram takes a WebP document
 * as a sticker, LINE sends a WebP as a bare file — and Electron decodes only those two, so the
 * decoder is the platform's (handed in). The file's bytes decide, not its name.
 */
import * as fs from 'node:fs/promises';
import { fitLongEdge, parseImageSize, sniffImageFormat } from './imageSize';

/** A WebP's bytes decoded to width × height as a JPEG of the given quality. */
export type WebpDecoder = (bytes: Buffer, width: number, height: number, quality: number) => Promise<Buffer>;

/** More than this is not decoded at all: a header can declare any size. */
const MAX_PIXELS = 40_000_000;
/** Enough of a file to tell a WebP and read its size. */
const HEADER_BYTES = 32;

async function readHeader(file: string): Promise<Buffer> {
  const handle = await fs.open(file, 'r');
  try {
    const buf = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(buf, 0, HEADER_BYTES, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * The JPEG for a WebP file, at its own size shrunk to fit `maxEdge` on its long side; null when the
 * file is not a WebP. Throws when it cannot be made one.
 */
export async function webpFileAsJpeg(file: string, decode: WebpDecoder, maxEdge: number, quality: number): Promise<Buffer | null> {
  const header = await readHeader(file);
  if (sniffImageFormat(header) !== 'webp') return null;
  const size = parseImageSize(header);
  if (!size || size.width <= 0 || size.height <= 0) throw new Error('the WebP declares no size');
  if (size.width * size.height > MAX_PIXELS) throw new Error(`the WebP is ${size.width}×${size.height}, too large to decode`);
  return decode(await fs.readFile(file), ...fitLongEdge(size.width, size.height, maxEdge), quality);
}
