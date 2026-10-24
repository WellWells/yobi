/**
 * A downloaded route map → the picture the answer carries, in the chat media folder. Three maps
 * are too big to send as they are: Telegram refuses a photo whose width plus height passes
 * 10,000 px, and Taichung's is 13161×13754, 三鶯線's 7016×9934, Taipei's 5867×8000. So the long
 * side is brought down to 4,000 px and the picture saved as JPEG; measured 2026-10-22 with
 * Electron's decoder: ~0.5 s and a passing ~0.9 GB for Taichung's, 0.45–1.3 MB out, names still
 * legible. Shrunk once per map version, then reused for every answer that day.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { nativeImage } from 'electron';
import { writeFileAtomic } from '../atomicWrite';
import { chatMediaDir, pruneChatMedia } from '../chatMedia';
import type { FoundMap } from './metroMaps';

export const MAP_PICTURE_LONG_SIDE = 4_000;
const JPEG_QUALITY = 85;

const shrunk = new Map<string, Buffer>();

function versionKey(map: FoundMap): string {
  return `${map.image}|${map.updated ?? ''}|${map.bytes.length}`;
}

/** The map as a JPEG no longer than `MAP_PICTURE_LONG_SIDE` on either side. */
export function shrinkMap(map: FoundMap): Buffer {
  const key = versionKey(map);
  const held = shrunk.get(key);
  if (held) return held;
  const image = nativeImage.createFromBuffer(Buffer.from(map.bytes));
  if (image.isEmpty()) throw new Error('the map image could not be decoded');
  const { width, height } = image.getSize();
  // Sized by the long side itself: scaling the short side rounds the long one to 4,001 (Taipei's map, 2026-10-22).
  const fitted = Math.max(width, height) <= MAP_PICTURE_LONG_SIDE ? image
    : image.resize(width >= height ? { width: MAP_PICTURE_LONG_SIDE, quality: 'good' } : { height: MAP_PICTURE_LONG_SIDE, quality: 'good' });
  const jpeg = fitted.toJPEG(JPEG_QUALITY);
  for (const old of shrunk.keys()) if (old.startsWith(`${map.image}|`)) shrunk.delete(old);
  shrunk.set(key, jpeg);
  return jpeg;
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/gu, '').replace('T', '-').slice(0, 15);
}

/** Writes this answer's copy of the map into the chat media folder; its path. */
export async function saveMapPicture(map: FoundMap): Promise<string> {
  const jpeg = shrinkMap(map);
  const dir = chatMediaDir();
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `metro-map-${map.system}-${stamp(new Date())}-${Math.random().toString(36).slice(2, 8)}.jpg`);
  await writeFileAtomic(file, jpeg);
  void pruneChatMedia().catch(() => {});
  return file;
}
