/**
 * The app's ImageCodec for a LINE file send: Electron's nativeImage. Loaded lazily (it pulls in
 * Electron), so the send's own modules stay testable with a fake codec.
 *
 * Measured on Electron 44 (Windows): createFromBuffer does not apply EXIF orientation (linePhoto
 * turns the preview upright itself), toBitmap gives premultiplied BGRA, and
 * createThumbnailFromPath gives the frame the Shell's thumbnail handlers make — the same source
 * line-cli asks Windows for — and rejects a file that has none rather than returning its icon.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { nativeImage, type NativeImage } from 'electron';
import { previewSize, type Bgra, type ImageCodec } from './linePhoto';

function bgraOf(image: NativeImage): Bgra {
  const { width, height } = image.getSize();
  const data = image.toBitmap();
  if (data.length !== width * height * 4) throw new Error('the image could not be decoded');
  return { data, width, height };
}

function scaled(image: NativeImage, width: number, height: number): NativeImage {
  const size = image.getSize();
  return size.width === width && size.height === height ? image : image.resize({ width, height, quality: 'best' });
}

export const electronImageCodec: ImageCodec = {
  decodeScaled: (bytes, width, height) => {
    const image = nativeImage.createFromBuffer(bytes);
    return image.isEmpty() ? null : bgraOf(scaled(image, width, height));
  },
  encodeJpeg: (image, quality) => nativeImage.createFromBitmap(image.data, { width: image.width, height: image.height }).toJPEG(quality),
  videoFrame: async (path, maxSide) => {
    let frame: NativeImage;
    try {
      frame = await nativeImage.createThumbnailFromPath(path, { width: maxSide, height: maxSide });
    } catch {
      throw new Error('Windows has no preview frame for this video; a codec may be missing');
    }
    const size = frame.getSize();
    if (frame.isEmpty() || size.width <= 0 || size.height <= 0) throw new Error('Windows returned an unreadable preview frame');
    const [width, height] = previewSize(size.width, size.height, maxSide);
    return bgraOf(scaled(frame, width, height));
  },
};

/**
 * A WebP as a JPEG of width × height (its own size, or smaller). nativeImage decodes only PNG and
 * JPEG (measured on Electron 44: a YouTube cover's WebP comes back empty); Windows has a WebP codec,
 * reached through the file's Shell thumbnail as a video's frame is. The thumbnail is scaled to fill
 * the box asked for — larger than the picture too — so ask for the picture's own size. Rejects when
 * Windows has no codec for it.
 */
export async function webpAsJpeg(bytes: Buffer, width: number, height: number, quality: number): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yobi-webp-'));
  try {
    const file = path.join(dir, 'picture.webp');
    await fs.writeFile(file, bytes);
    let frame: NativeImage;
    try {
      frame = await nativeImage.createThumbnailFromPath(file, { width, height });
    } catch {
      throw new Error('Windows could not decode this WebP picture; its WebP codec may be missing');
    }
    if (frame.isEmpty()) throw new Error('Windows returned an empty picture for this WebP');
    return frame.toJPEG(quality);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
