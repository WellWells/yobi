import { createHash } from 'node:crypto';
import type { PhotoCopy } from '../../../shared/xMedia';
import { tiktokPostUrl } from '../../../shared/linkSites/tiktokLinks';
import { arr, obj, str, type Json } from './jsonPick';
import type { XMedia, XPost, XVideoVariant } from './xPosts';

/*
 * Parsing a TikTok post page: the challenge page's answer cookies (ported from yt-dlp's
 * `_solve_challenge_and_set_cookies`, Unlicense), then the post in the page's rehydration data.
 * Only H.264 video versions are kept, so Telegram on iOS can play them.
 */

/** Rehydration data, `statusCode` 0 and an item; anything else is a post the page does not show. */
export interface TikTokPage {
  statusCode: number;
  item: Json | null;
}

export interface WafCookie {
  name: string;
  value: string;
}

const MAX_WORK = 1_000_000;

/** Counts arrive as numbers or numeric strings (`createTime`, `collectCount`), depending on the field. */
function count(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return 0;
}

function paragraphClass(html: string, id: string): string {
  return new RegExp(`<p[^>]*\\bid="${id}"[^>]*\\bclass="([^"]*)"`).exec(html)?.[1] ?? '';
}

/**
 * The cookies that answer the challenge page `html`; null when the page is no challenge or the
 * challenge has a shape this does not know (TikTok changed it).
 */
export function solveTikTokChallenge(html: string): WafCookie[] | null {
  const encoded = paragraphClass(html, 'cs');
  const name = paragraphClass(html, 'wci');
  if (!encoded || !name) return null;
  let challenge: Json | undefined;
  try {
    challenge = obj(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')));
  } catch {
    return null;
  }
  const v = obj(challenge?.v);
  const base = Buffer.from(str(v?.a), 'base64');
  const want = Buffer.from(str(v?.c), 'base64');
  if (!challenge || base.length === 0 || want.length !== 32) return null;
  for (let n = 0; n <= MAX_WORK; n++) {
    if (!createHash('sha256').update(base).update(String(n)).digest().equals(want)) continue;
    const answered = { ...challenge, d: Buffer.from(String(n)).toString('base64') };
    const cookies = [{ name, value: Buffer.from(JSON.stringify(answered)).toString('base64') }];
    const extraName = paragraphClass(html, 'rci');
    const extraValue = paragraphClass(html, 'rs');
    if (extraName && extraValue) cookies.push({ name: extraName, value: extraValue });
    return cookies;
  }
  return null;
}

/** The post data of a TikTok page; null when the page carries none (the challenge, or a changed page). */
export function readTikTokPage(html: string): TikTokPage | null {
  const raw = /<script[^>]+\bid="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const detail = obj(obj(obj(data)?.__DEFAULT_SCOPE__)?.['webapp.video-detail']);
  if (!detail) return null;
  const item = obj(obj(detail.itemInfo)?.itemStruct) ?? null;
  return { statusCode: count(detail.statusCode), item: item && str(item.id) ? item : null };
}

/** TikTok's media hosts: its CDNs and the `v16-webapp…` subdomains, never its own pages. */
export function isTikTokMediaHost(host: string): boolean {
  const lower = host.toLowerCase();
  if (lower === 'www.tiktok.com' || lower === 'm.tiktok.com' || lower === 'tiktok.com') return false;
  return /(?:^|\.)(?:tiktok\.com|tiktokcdn(?:-[a-z]+)?\.com|tiktokv\.com)$/.test(lower);
}

function mediaUrl(value: unknown): string {
  const raw = str(value);
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    return isTikTokMediaHost(url.hostname) ? url.toString() : '';
  } catch {
    return '';
  }
}

function firstMediaUrl(list: unknown): string {
  for (const raw of arr(list)) {
    const url = mediaUrl(raw);
    if (url) return url;
  }
  return '';
}

/** `zoomCover`'s jpegs: `{ "240": url, … }`, each that many pixels on the long side. */
function coverCopies(video: Json, width: number, height: number): PhotoCopy[] {
  const zoom = obj(video.zoomCover);
  if (!zoom || width <= 0 || height <= 0) return [];
  return Object.entries(zoom).flatMap(([box, raw]) => {
    const url = mediaUrl(raw);
    const long = Number(box);
    if (!url || !Number.isInteger(long) || long <= 0) return [];
    const scale = long / Math.max(width, height);
    return [{ url, width: Math.round(width * scale), height: Math.round(height * scale) }];
  });
}

function h264Variants(video: Json): XVideoVariant[] {
  const seen = new Set<string>();
  const variants: XVideoVariant[] = [];
  for (const raw of arr(video.bitrateInfo)) {
    const info = obj(raw);
    const play = obj(info?.PlayAddr);
    if (!info || !play || !str(info.CodecType).toLowerCase().startsWith('h264')) continue;
    const url = firstMediaUrl(play.UrlList);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const size = count(play.DataSize);
    variants.push({
      url,
      bitrate: count(info.Bitrate),
      width: count(play.Width) || count(video.width),
      height: count(play.Height) || count(video.height),
      ...(size > 0 ? { sizeBytes: size } : {}),
    });
  }
  // A page without the list still names its default version, when that one is H.264.
  if (variants.length === 0 && str(video.codecType).toLowerCase().startsWith('h264')) {
    const url = mediaUrl(video.playAddr);
    if (url) variants.push({ url, bitrate: count(video.bitrate), width: count(video.width), height: count(video.height) });
  }
  return variants.sort((a, b) => b.bitrate - a.bitrate);
}

function videoMedia(video: Json): XMedia | null {
  const width = count(video.width);
  const height = count(video.height);
  const variants = h264Variants(video);
  if (variants.length === 0) return null;
  const copies = coverCopies(video, width, height);
  const image = mediaUrl(video.cover) || mediaUrl(video.originCover) || copies.at(-1)?.url || '';
  return { kind: 'video', image, width, height, durationMs: count(video.duration) * 1_000, variants, copies };
}

function photoMedia(imagePost: Json): XMedia[] {
  return arr(imagePost.images).flatMap((raw) => {
    const image = obj(raw);
    const url = firstMediaUrl(obj(image?.imageURL)?.urlList);
    if (!image || !url) return [];
    return [{ kind: 'photo' as const, image: url, width: count(image.imageWidth), height: count(image.imageHeight), durationMs: 0, variants: [] }];
  });
}

/** A photo post's title and its caption; a video has only the caption. */
function textOf(item: Json, imagePost: Json | undefined): string {
  const title = str(imagePost?.title).trim();
  const desc = str(item.desc).trim();
  return [title, desc].filter((part, index, all) => part && all.indexOf(part) === index).join('\n\n');
}

/**
 * The post a page's item describes. A video with no H.264 version (H.265 only) comes with no
 * media: the text still goes, and the forward says the post has none to send.
 */
export function tiktokPost(item: Json): XPost {
  const author = obj(item.author);
  const stats = obj(item.stats) ?? obj(item.statsV2);
  const imagePost = obj(item.imagePost);
  const handle = str(author?.uniqueId);
  const id = str(item.id);
  const media = imagePost ? photoMedia(imagePost) : [videoMedia(obj(item.video) ?? {})].filter((m): m is XMedia => m !== null);
  return {
    id,
    author: handle,
    name: str(author?.nickname),
    createdAt: count(item.createTime) * 1_000,
    text: textOf(item, imagePost),
    link: tiktokPostUrl(imagePost ? 'photo' : 'video', id, handle),
    image: media[0] ? (media[0].copies?.at(-1)?.url ?? media[0].image) : '',
    replyCount: count(stats?.commentCount),
    likeCount: count(stats?.diggCount),
    inReplyTo: '',
    isRepost: false,
    media,
    quoteMedia: [],
  };
}

export interface TikTokCommentPage {
  comments: XPost[];
  /** Where the next page starts; null when there is none. */
  next: number | null;
}

/** One page of `/api/comment/list/`: top-level comments with text, in the site's order. */
export function readTikTokComments(body: unknown, postLink: string): TikTokCommentPage {
  const answer = obj(body);
  const comments = arr(answer?.comments).flatMap((raw): XPost[] => {
    const comment = obj(raw);
    const id = str(comment?.cid);
    const text = str(comment?.text).trim();
    if (!comment || !id || !text) return [];
    const user = obj(comment.user);
    return [{
      id,
      author: str(user?.unique_id),
      name: str(user?.nickname),
      createdAt: count(comment.create_time) * 1_000,
      text,
      link: postLink,
      image: '',
      replyCount: count(comment.reply_comment_total),
      likeCount: count(comment.digg_count),
      inReplyTo: '',
      isRepost: false,
      media: [],
      quoteMedia: [],
    }];
  });
  const more = count(answer?.has_more) === 1 || answer?.has_more === true;
  const cursor = count(answer?.cursor);
  return { comments, next: more && cursor > 0 ? cursor : null };
}
