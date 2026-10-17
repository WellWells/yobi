import type { PhotoCopy } from '../../../shared/xMedia';
import { num, obj, scriptJson, str, type Json } from './jsonPick';
import { cdnUrl } from './metaMedia';
import type { XMedia, XVideoVariant } from './xPosts';

/**
 * A Facebook page's JSON (`<script type="application/json">` blocks, parsed, never run), indexed,
 * and the photos and videos in it. A video is found by its id, never by query name or order.
 */

const MAX_DEPTH = 160;

export interface FacebookPage {
  /** Every object that names itself with a string id, by that id. */
  byId: Map<string, Json[]>;
  /** Objects that carry a post's own fields: text, people, time, comments. */
  posts: Json[];
  /** Each prefetched query's `data`, by query name. */
  queries: Array<{ name: string; data: Json }>;
}

function index(node: unknown, page: FacebookPage, depth: number): void {
  if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return;
  if (Array.isArray(node)) {
    const [name, value] = node;
    const data = obj(obj(obj(obj(value)?.__bbox)?.result)?.data);
    if (typeof name === 'string' && name.startsWith('adp_') && data) page.queries.push({ name, data });
    for (const item of node) index(item, page, depth + 1);
    return;
  }
  const json = node as Json;
  const id = json.id;
  if (typeof id === 'string' && id) {
    const list = page.byId.get(id);
    if (list) list.push(json);
    else page.byId.set(id, [json]);
  }
  const ownFields = 'post_id' in json || 'message' in json || 'creation_story' in json;
  const linked = 'attachments' in json || 'video' in json || 'feedback' in json || 'creation_story' in json;
  if (ownFields && linked) page.posts.push(json);
  for (const value of Object.values(json)) index(value, page, depth + 1);
}

export function readFacebookPage(html: string): FacebookPage {
  const page: FacebookPage = { byId: new Map(), posts: [], queries: [] };
  for (const block of scriptJson(html, { sjsOnly: false })) index(block, page, 0);
  return page;
}

/** The encode tag Facebook stamps into a CDN video URL (`efg`, base64 JSON); "" when there is none. */
function encodeTag(url: string): string {
  try {
    const efg = new URL(url).searchParams.get('efg');
    return efg ? str(obj(JSON.parse(atob(efg)))?.vencode_tag) : '';
  } catch {
    return '';
  }
}

/** H.264 only, so the file plays inline in Telegram on iOS; anything tagged another codec is left out. */
function isH264(url: string): boolean {
  return !/av1|av01|vp9|vp09|hevc|h265/i.test(encodeTag(url));
}

/** A whole mp4 on Meta's CDN; a DASH manifest (`.mpd`) is not one. */
function fileUrl(raw: unknown): string {
  const url = cdnUrl(raw);
  return url && !new URL(url).pathname.toLowerCase().endsWith('.mpd') ? url : '';
}

/** Each playback field and whether it names the HD version, which ranks a version the tag does not size. */
const PLAYBACK_KEYS = [
  ['browser_native_hd_url', true], ['playable_url_quality_hd', true], ['browser_native_sd_url', false], ['playable_url', false],
] as const;
/** Fields that hold another post or person, never this video's playback. */
const NOT_PLAYBACK = new Set(['creation_story', 'owner', 'feedback', 'attachments', 'video_owner', 'actors']);

interface Playback {
  url: string;
  hd: boolean;
}

/** The progressive mp4s a video object carries, in the playback fields and the delivery result alike. */
function collectPlayback(node: unknown, out: Playback[], depth: number): void {
  if (!node || typeof node !== 'object' || depth > 6) return;
  if (Array.isArray(node)) {
    for (const item of node) collectPlayback(item, out, depth + 1);
    return;
  }
  const json = node as Json;
  for (const [key, hd] of PLAYBACK_KEYS) {
    const url = fileUrl(json[key]);
    if (url) out.push({ url, hd });
  }
  const progressive = fileUrl(json.progressive_url);
  if (progressive) out.push({ url: progressive, hd: str(obj(json.metadata)?.quality).toUpperCase() === 'HD' });
  for (const [key, value] of Object.entries(json)) if (!NOT_PLAYBACK.has(key)) collectPlayback(value, out, depth + 1);
}

function firstNum(objects: readonly Json[], ...keys: string[]): number {
  for (const o of objects) for (const key of keys) if (num(o[key]) > 0) return num(o[key]);
  return 0;
}

function thumbnailOf(objects: readonly Json[]): string {
  for (const o of objects) {
    const url = cdnUrl(obj(obj(o.preferred_thumbnail)?.image)?.uri) || cdnUrl(o.first_frame_thumbnail)
      || cdnUrl(obj(o.thumbnailImage)?.uri) || cdnUrl(obj(o.image)?.uri);
    if (url) return url;
  }
  return '';
}

/** The width an encode tag names (`…C3.720.…`), which sizes the version against the video's shape. */
function taggedWidth(url: string): number {
  return Number(/\.C3\.(\d{2,5})\./.exec(encodeTag(url))?.[1] ?? 0);
}

/**
 * The size a version plays at: the tag's width in the video's shape; an untagged HD version the
 * video's own size; otherwise unknown (0×0), which the HEAD request still sizes in bytes.
 */
function versionSize(playback: Playback, width: number, height: number): { width: number; height: number } {
  const tagged = taggedWidth(playback.url);
  if (tagged > 0 && width > 0) return { width: tagged, height: Math.round((tagged * height) / width) };
  return playback.hd ? { width, height } : { width: 0, height: 0 };
}

/** One video by its id: its H.264 mp4s, best first, its size, length and poster; null when none plays. */
export function videoMedia(page: FacebookPage, videoId: string): XMedia | null {
  const objects = page.byId.get(videoId) ?? [];
  const found: Playback[] = [];
  for (const o of objects) collectPlayback(o, found, 0);
  const width = firstNum(objects, 'width', 'original_width');
  const height = firstNum(objects, 'height', 'original_height');
  const seen = new Set<string>();
  const ranked: Array<XVideoVariant & { hd: boolean }> = [];
  for (const playback of found) {
    if (seen.has(playback.url) || !isH264(playback.url)) continue;
    seen.add(playback.url);
    // The page gives no bitrate; the HEAD request sizes each version.
    ranked.push({ url: playback.url, bitrate: 0, ...versionSize(playback, width, height), hd: playback.hd });
  }
  if (ranked.length === 0) return null;
  // Widest first; where widths are unknown, HD before SD. `pickVariant` keeps this order among equals.
  ranked.sort((a, b) => b.width - a.width || Number(b.hd) - Number(a.hd));
  const variants = ranked.map((v): XVideoVariant => ({ url: v.url, bitrate: v.bitrate, width: v.width, height: v.height }));
  const durationMs = firstNum(objects, 'playable_duration_in_ms') || Math.round(firstNum(objects, 'length_in_second') * 1_000);
  return { kind: 'video', image: thumbnailOf(objects), width, height, durationMs, variants };
}

const PHOTO_IMAGE_KEYS = ['image', 'photo_image', 'full_image', 'large_share_image', 'viewer_image'] as const;

/** Every copy of one photo the page names, widest first. */
function photoCopies(objects: readonly Json[]): PhotoCopy[] {
  const seen = new Set<string>();
  const copies: PhotoCopy[] = [];
  for (const o of objects) {
    for (const key of PHOTO_IMAGE_KEYS) {
      const image = obj(o[key]);
      const url = cdnUrl(image?.uri);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      copies.push({ url, width: num(image?.width), height: num(image?.height) });
    }
  }
  return copies.sort((a, b) => b.width - a.width);
}

/** One photo by its id, with every copy the page and `extra` (its own photo page) name. */
export function photoMedia(page: FacebookPage, photoId: string, extra: readonly Json[] = []): XMedia | null {
  const objects = [...extra, ...(page.byId.get(photoId) ?? [])];
  const copies = photoCopies(objects);
  if (copies.length === 0) return null;
  const viewer = objects.map((o) => obj(o.viewer_image) ?? {});
  const width = Math.max(copies[0].width, firstNum(viewer, 'width'));
  const height = Math.max(copies[0].height, firstNum(viewer, 'height'));
  return { kind: 'photo', image: copies[0].url, width, height, durationMs: 0, variants: [], copies };
}

/** What a photo's own page says about it: the objects that name it, full-size `image` included. */
export function readPhotoPage(html: string, photoId: string): Json[] {
  return readFacebookPage(html).byId.get(photoId) ?? [];
}
