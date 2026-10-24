import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { nativeImage } from 'electron';
import type { NativeImage } from 'electron';
import { ATTACHMENT_STASH_MAX_BYTES, BYOK_IMAGE_MAX_FILES } from '../../shared/types';
import { IMAGE_FORMAT_MIMES, parseImageSize, sniffImageFormat } from '../imageSize';
import { sendLog } from '../helpers';
import { byokTargetTakesImages } from './byokClient';
import type { ByokChatMessage, ByokImage, ByokPrompt } from './byokClient';

export const BYOK_IMAGE_UNUSABLE_PREFIX = 'BYOK image unusable: ';

/**
 * Longest edge sent. Claude scales anything larger down to about this before reading it, and
 * Gemini tiles it, so more pixels only cost upload time and request size.
 */
const MAX_EDGE = 1_568;
/**
 * Per picture, after re-encoding. Five of them stay well under Gemini's 20 MB inline request
 * limit once base64 grows them by a third.
 */
const MAX_ENCODED_BYTES = 1_500_000;
const MAX_PIXELS = 40_000_000;
const JPEG_QUALITY = 85;
const MIN_JPEG_QUALITY = 45;

export interface DecodedImage {
  width: number;
  height: number;
  resize: (width: number, height: number) => DecodedImage;
  toPNG: () => Buffer;
  toJPEG: (quality: number) => Buffer;
}

export type ImageDecoder = (raw: Buffer) => DecodedImage | null;

function wrapNative(image: NativeImage): DecodedImage {
  const { width, height } = image.getSize();
  return {
    width,
    height,
    resize: (w, h) => wrapNative(image.resize({ width: w, height: h, quality: 'better' })),
    toPNG: () => image.toPNG(),
    toJPEG: (quality) => image.toJPEG(quality),
  };
}

const nativeDecoder: ImageDecoder = (raw) => {
  const image = nativeImage.createFromBuffer(raw);
  return image.isEmpty() ? null : wrapNative(image);
};

/**
 * Puts `images` on the prompt's first user message — the opening request of a conversation, which
 * every later request of the same run sends again. No pictures = the prompt as it was.
 */
export function withByokImages(prompt: ByokPrompt, images: readonly ByokImage[] | undefined): ByokPrompt {
  if (!images?.length) return prompt;
  const messages: readonly ByokChatMessage[] = typeof prompt === 'string' ? [{ role: 'user', content: prompt }] : prompt;
  const first = messages.findIndex((message) => message.role === 'user');
  if (first < 0) return prompt;
  return messages.map((message, index) => (index === first
    ? { ...message, images: [...images, ...(message.images ?? [])] }
    : message));
}

function asImage(mimeType: string, bytes: Buffer): ByokImage {
  return { mimeType, data: bytes.toString('base64') };
}

/**
 * A picture as one image-taking key reads it: PNG, JPEG or WebP, at most `MAX_EDGE` on its long
 * side and `MAX_ENCODED_BYTES` big. Sent as it is when it already fits; otherwise re-encoded — a
 * PNG stays PNG while that fits (screenshots keep sharp text and transparency), else JPEG.
 * null = not a picture this can send (unknown bytes, a GIF it cannot decode, a pixel bomb).
 */
export function prepareByokImage(raw: Buffer, decode: ImageDecoder = nativeDecoder): ByokImage | null {
  const format = sniffImageFormat(raw);
  if (!format) return null;
  const declared = parseImageSize(raw);
  if (declared && declared.width * declared.height > MAX_PIXELS) return null;
  const sendable = format !== 'gif';

  const decoded = decode(raw);
  if (!decoded) {
    // Electron decodes PNG and JPEG everywhere, WebP not reliably: a small one goes as it is.
    return sendable && raw.length <= MAX_ENCODED_BYTES ? asImage(IMAGE_FORMAT_MIMES[format], raw) : null;
  }
  const { width, height } = decoded;
  if (!width || !height || width * height > MAX_PIXELS) return null;
  if (sendable && width <= MAX_EDGE && height <= MAX_EDGE && raw.length <= MAX_ENCODED_BYTES) {
    return asImage(IMAGE_FORMAT_MIMES[format], raw);
  }

  const scale = Math.min(1, MAX_EDGE / width, MAX_EDGE / height);
  const out = scale < 1
    ? decoded.resize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)))
    : decoded;
  if (format === 'png') {
    const png = out.toPNG();
    if (png.length > 0 && png.length <= MAX_ENCODED_BYTES) return asImage(IMAGE_FORMAT_MIMES.png, png);
  }
  let quality = JPEG_QUALITY;
  let jpeg = out.toJPEG(quality);
  while (jpeg.length > MAX_ENCODED_BYTES && quality > MIN_JPEG_QUALITY) {
    quality -= 10;
    jpeg = out.toJPEG(quality);
  }
  if (jpeg.length === 0 || jpeg.length > MAX_ENCODED_BYTES) return null;
  return asImage(IMAGE_FORMAT_MIMES.jpeg, jpeg);
}

function unusable(filePath: string): Error {
  return new Error(`${BYOK_IMAGE_UNUSABLE_PREFIX}${path.basename(filePath)}`);
}

/**
 * Reads attached files as pictures for a BYOK request, in order, at most `BYOK_IMAGE_MAX_FILES`.
 * Throws `BYOK_IMAGE_UNUSABLE_PREFIX` + the file name for one it cannot send: answering without
 * a picture the user asked about would read as if the model had looked at it.
 */
export async function loadByokImages(
  filePaths: readonly string[],
  decode: ImageDecoder = nativeDecoder,
): Promise<ByokImage[]> {
  const images: ByokImage[] = [];
  for (const filePath of filePaths.slice(0, BYOK_IMAGE_MAX_FILES)) {
    let raw: Buffer;
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile() || stat.size > ATTACHMENT_STASH_MAX_BYTES) throw unusable(filePath);
      raw = await fs.readFile(filePath);
    } catch {
      throw unusable(filePath);
    }
    const image = prepareByokImage(raw, decode);
    if (!image) throw unusable(filePath);
    images.push(image);
  }
  return images;
}

/**
 * The pictures a BYOK request carries for `attachments`: none when there are none, or when the key
 * reads no pictures (the composer never offers one there; anything else that gets through is
 * logged and sent as text, as before pictures were supported).
 */
export async function byokImagesFor(
  targetUrl: string,
  attachments: readonly string[] | undefined,
  logLabel: string,
): Promise<ByokImage[] | undefined> {
  if (!attachments?.length) return undefined;
  if (!byokTargetTakesImages(targetUrl)) {
    sendLog(`⚠️ ${logLabel} This BYOK key reads no images — ${attachments.length} attachment(s) not sent`);
    return undefined;
  }
  const images = await loadByokImages(attachments);
  if (attachments.length > images.length) {
    sendLog(`⚠️ ${logLabel} A BYOK request takes at most ${BYOK_IMAGE_MAX_FILES} images — ${attachments.length - images.length} not sent`);
  }
  sendLog(`🖼️ ${logLabel} Sending ${images.length} image(s) to the BYOK key`);
  return images;
}
