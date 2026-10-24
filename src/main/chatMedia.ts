import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { app } from 'electron';
import { sendLog } from './helpers';
import { saveIntoFolder } from './flow/skills/savedDownloads';
import { writeFileAtomic } from './atomicWrite';
import { generatedImageFileName } from './providers/generatedImages';
import type { GeneratedImage } from './providers/generatedImages';

/**
 * Photos and videos the desktop chat shows without the person having asked to keep them: a
 * pasted post's media and a video's cover. They live here, not in the Downloads
 * folder — "download" is a button — and the oldest go once the folder passes its cap, so a
 * conversation opened much later may show the post without its media.
 */
export const CHAT_MEDIA_MAX_BYTES = 1_000_000_000;

export function chatMediaDir(): string {
  return path.join(app.getPath('userData'), 'chat-media');
}

/** Moves `file` into the chat media folder under `fileName` (numbered when taken). */
export async function keepForChat(file: string, fileName: string): Promise<string> {
  const kept = await saveIntoFolder(file, chatMediaDir(), fileName);
  void pruneChatMedia().catch(() => {});
  return kept;
}

/**
 * Pictures a provider drew for an answer, written into the chat media folder; the paths in the
 * answer's order. One that cannot be written is logged and left out, so the answer still lands.
 */
export async function keepImagesForChat(images: readonly GeneratedImage[], prefix: string): Promise<string[]> {
  if (images.length === 0) return [];
  const dir = chatMediaDir();
  await fs.mkdir(dir, { recursive: true });
  const now = new Date();
  const kept: string[] = [];
  for (const [index, image] of images.entries()) {
    const file = path.join(dir, generatedImageFileName(prefix, image, index, now));
    try {
      if (await fs.stat(file).then(() => true, () => false)) throw new Error(`${path.basename(file)} already exists`);
      await writeFileAtomic(file, image.bytes);
      kept.push(file);
    } catch (err) {
      sendLog(`⚠️ [Chat media] Picture not kept: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  void pruneChatMedia().catch(() => {});
  return kept;
}

const COVER_TIMEOUT_MS = 10_000;
const COVER_MAX_BYTES = 5_000_000;

export interface ChatCover {
  /** The file name's prefix for the site (`yt`). */
  prefix: string;
  /** The video's id on its site: one cover per video. */
  id: string;
  /** The cover's URL as the site gave it; only https is fetched. */
  url: string;
  /** The hosts the site serves its covers from. */
  host: RegExp;
}

/**
 * A video's cover for the desktop menu, fetched once per video and kept with the chat's media;
 * "" when it is not an https image on the site's own cover hosts or cannot be fetched (the menu
 * goes without). A site whose covers come as `http:` or `//host` links turns them into https first.
 */
export async function coverForChat(cover: ChatCover): Promise<string> {
  let url: URL;
  try {
    url = new URL(cover.url);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:' || !cover.host.test(url.hostname) || url.username || url.password) return '';
  const ext = path.extname(url.pathname).toLowerCase() === '.webp' ? '.webp' : '.jpg';
  const file = path.join(chatMediaDir(), `${cover.prefix}-${cover.id.replace(/[^\w-]/g, '')}${ext}`);
  if (await fs.stat(file).then((s) => s.isFile() && s.size > 0, () => false)) return file;
  try {
    const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(COVER_TIMEOUT_MS) });
    const bytes = res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    if (!bytes || bytes.length === 0 || bytes.length > COVER_MAX_BYTES) return '';
    await fs.mkdir(chatMediaDir(), { recursive: true });
    await fs.writeFile(file, bytes);
    void pruneChatMedia().catch(() => {});
    return file;
  } catch (err) {
    sendLog(`⚠️ [Chat media] Cover not fetched (${cover.prefix}-${cover.id}): ${err instanceof Error ? err.message : String(err)}`);
    return '';
  }
}

/** A YouTube video's cover for the menu: one of YouTube's https thumbnails. */
export function youtubeCoverForChat(videoId: string, image: string): Promise<string> {
  return coverForChat({ prefix: 'yt', id: videoId, url: image, host: /(^|\.)ytimg\.com$/i });
}

/** Deletes the oldest files until the folder is under `maxBytes`; returns how many went. */
export async function pruneChatMedia(maxBytes = CHAT_MEDIA_MAX_BYTES, dir = chatMediaDir()): Promise<number> {
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const files: Array<{ file: string; size: number; at: number }> = [];
  for (const name of names) {
    const file = path.join(dir, name);
    const stat = await fs.stat(file).catch(() => null);
    if (stat?.isFile()) files.push({ file, size: stat.size, at: stat.mtimeMs });
  }
  let total = files.reduce((sum, f) => sum + f.size, 0);
  let removed = 0;
  for (const f of files.sort((a, b) => a.at - b.at)) {
    if (total <= maxBytes) break;
    await fs.rm(f.file, { force: true }).catch(() => {});
    total -= f.size;
    removed += 1;
  }
  if (removed > 0) sendLog(`🧹 [Chat media] Removed ${removed} old file(s) over the ${Math.round(maxBytes / 1_000_000)} MB cap`);
  return removed;
}
