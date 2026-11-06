/**
 * A WebP picture that goes to Telegram as a photo is made a JPEG first. Telegram takes a WebP
 * document as a sticker, and no album holds a sticker: a post's WebP photos sent as documents were
 * refused as a whole ("Wrong file identifier/HTTP URL specified").
 */
import * as path from 'node:path';
import { webpFileAsJpeg as decodeWebpFile, type WebpDecoder } from '../webpJpeg';

export type { WebpDecoder } from '../webpJpeg';

/** The long side Telegram keeps a photo at; decoding larger only costs time. */
const MAX_EDGE = 2_560;
const JPEG_QUALITY = 90;

/** The JPEG for a WebP file; null when the file is not a WebP. Throws when it cannot be made one. */
export function webpFileAsJpeg(file: string, decode: WebpDecoder): Promise<Buffer | null> {
  return decodeWebpFile(file, decode, MAX_EDGE, JPEG_QUALITY);
}

/** The name a WebP's JPEG goes up under. */
export function jpegName(file: string): string {
  return `${path.parse(file).name}.jpg`;
}
