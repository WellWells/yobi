import type { PhotoCopy } from '../../../shared/xMedia';
import { arr, num, obj, scriptJson, str, type Json } from './jsonPick';
import type { XMedia } from './xPosts';

/**
 * Threads and Instagram describe a photo or video in the same shape — `image_versions2`,
 * `video_versions`, `carousel_media` — whether a page prefetched it or the API answered with it.
 * Both sites' readers share this. The JSON is parsed, never run.
 */

/** An id the site sends as a number or a string; "" when it sent neither. */
export function idOf(value: unknown): string {
  if (typeof value === 'string') return value;
  return typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : '';
}

/**
 * Every prefetched query result on the page, `data` by query name. `marker` picks the blocks
 * worth parsing: most of them are the page's own modules.
 */
export function readPrefetchedQueries(html: string, marker: string): Map<string, Json> {
  const out = new Map<string, Json>();
  const visit = (node: unknown, depth: number): void => {
    if (depth > 16 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      const [name, value] = node;
      const data = obj(obj(obj(obj(value)?.__bbox)?.result)?.data);
      if (typeof name === 'string' && name.startsWith('adp_') && data) {
        if (!out.has(name)) out.set(name, data);
        return;
      }
      for (const item of node) visit(item, depth + 1);
      return;
    }
    for (const value of Object.values(node)) visit(value, depth + 1);
  };
  for (const block of scriptJson(html, { sjsOnly: true, marker })) visit(block, 0);
  return out;
}

export function queryData(queries: Map<string, Json>, prefix: string): Json | undefined {
  for (const [name, data] of queries) if (name.startsWith(prefix)) return data;
  return undefined;
}

/** Only Meta's own CDN over https: these URLs are handed to Telegram, LINE and Gemini as they are. */
export function cdnUrl(raw: unknown): string {
  const value = str(raw);
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const meta = host.endsWith('.cdninstagram.com') || host.endsWith('.fbcdn.net');
    return url.protocol === 'https:' && meta && !url.username && !url.password && !url.port ? value : '';
  } catch {
    return '';
  }
}

/** The copies in the original's shape, widest first: the sites also serve square crops, which cut the picture. */
function photoCopies(media: Json): PhotoCopy[] {
  const width = num(media.original_width);
  const height = num(media.original_height);
  const copies = arr(obj(media.image_versions2)?.candidates)
    .map((c) => ({ url: cdnUrl(obj(c)?.url), width: num(obj(c)?.width), height: num(obj(c)?.height) }))
    .filter((c) => c.url && c.width > 0 && c.height > 0);
  const shaped = width > 0 && height > 0
    ? copies.filter((c) => Math.abs(c.width / c.height - width / height) < 0.02)
    : copies;
  return (shaped.length > 0 ? shaped : copies).sort((a, b) => b.width - a.width);
}

/**
 * The picture when no copy says its size: Instagram's signed-out page lists a photo post's
 * candidates without one, the first being the original.
 */
function unsizedImage(media: Json): string {
  return cdnUrl(obj(arr(obj(media.image_versions2)?.candidates)[0])?.url) || cdnUrl(media.display_uri);
}

/** One photo or video; null for anything else (a GIF sticker, a post without media). */
export function mediaItem(media: Json): XMedia | null {
  const copies = photoCopies(media);
  const width = num(media.original_width);
  const height = num(media.original_height);
  const seen = new Set<string>();
  const variants = arr(media.video_versions).flatMap((v) => {
    const url = cdnUrl(obj(v)?.url);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    // Sizes come from the server; the page gives no bitrate.
    return [{ url, bitrate: 0, width: num(obj(v)?.width) || width, height: num(obj(v)?.height) || height }];
  });
  const image = copies[0]?.url || unsizedImage(media);
  const durationMs = Math.round(num(media.video_duration) * 1_000);
  if (variants.length > 0) return { kind: 'video', image, width, height, durationMs, variants, copies };
  if (num(media.media_type) === 1 && image) return { kind: 'photo', image, width, height, durationMs: 0, variants: [], copies };
  return null;
}

/** A post's own photos and videos, in order: a carousel's items, else the post itself. */
export function ownMedia(media: Json): XMedia[] {
  const carousel = arr(media.carousel_media).map(obj).filter((m): m is Json => m !== undefined);
  const items = carousel.length > 0 ? carousel.map(mediaItem) : [mediaItem(media)];
  return items.filter((m): m is XMedia => m !== null);
}
