import { load } from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { DashManifest } from '../../downloader/dashManifest';
import { bestAacAudio, estimateBytes, isH264 } from '../../downloader/streamChoices';
import type { PhotoCopy } from '../../../shared/xMedia';
import type { XMedia, XPost, XVideoVariant } from './xPosts';

/*
 * A signed-out Reddit post page, parsed and never run: the post's `<shreddit-post>` attributes,
 * its rich-text body, the player's ready mp4s or v.redd.it's DASH, a gallery's slides, and the
 * first `<shreddit-comment>` elements. A check or block page carries no `<shreddit-app>`.
 */

const SITE = 'https://www.reddit.com';
/** Comments the analysis reads: what the page itself carries. */
export const REDDIT_MAX_COMMENTS = 25;
/** The hosts Reddit serves a post's pictures and videos from. */
export const REDDIT_MEDIA_HOSTS = ['i.redd.it', 'preview.redd.it', 'external-preview.redd.it', 'v.redd.it', 'packaged-media.redd.it'] as const;
/**
 * A single picture's original has no size on the page: listed as this wide, so Telegram and this
 * computer get the original while LINE (whose photo is its own 1 MB preview) gets a 1080 copy.
 */
const UNSIZED_ORIGINAL_WIDTH = 2_560;
/** The same text again and again would only be noise: one comment is cut here. */
const COMMENT_MAX_CHARS = 2_000;

export type RedditPageKind =
  /** The post's page. */
  | 'post'
  /** An 18+ or quarantined post (or its gate): Reddit shows it to a signed-in account only. */
  | 'gated'
  /** A check page (script, captcha) or a block: no post until a browser passes it. */
  | 'check'
  /** Reddit's own page with no post on it (removed, unknown, not a post). */
  | 'none';

export interface RedditComment {
  id: string;
  author: string;
  depth: number;
  parentId: string;
  score: number;
  createdAt: number;
  text: string;
  /** The comment's own address. */
  link: string;
}

export type RedditMedia =
  | { kind: 'none' }
  | { kind: 'images'; items: XMedia[] }
  /** A v.redd.it video: `variants` the ready mp4s when the page has them, else empty (DASH). */
  | { kind: 'video'; videoId: string; poster: string; durationMs: number; variants: XVideoVariant[] };

export interface RedditPage {
  id: string;
  title: string;
  /** "" for a deleted account. */
  author: string;
  /** `r/<name>`. */
  community: string;
  /** The post's own address. */
  link: string;
  createdAt: number;
  score: number;
  commentCount: number;
  postType: string;
  /** The text body, links written out; "" for none. */
  body: string;
  /** The linked page of a link post; "" otherwise. */
  linkUrl: string;
  /** Marked 18+ or quarantined: shown to signed-in accounts only. */
  gated: boolean;
  media: RedditMedia;
  comments: RedditComment[];
}

/** What a page is, from its HTML alone. */
export function redditPageKind(html: string): RedditPageKind {
  const post = /<shreddit-post\b[^>]*>/.exec(html)?.[0];
  if (post) return isGatedPost(post) ? 'gated' : 'post';
  if (/<xpromo-nsfw-blocking-container\b/.test(html)) return 'gated';
  if (/<shreddit-app\b/.test(html)) return 'none';
  return 'check';
}

function isGatedPost(tag: string): boolean {
  return /\s(?:nsfw|quarantined)(?=[\s>=])/.test(tag);
}

/** A check page's own markers, for the log: the script check, a captcha, a block. */
export function checkPageReason(html: string): string {
  if (/name="jsc_token"|js_challenge/.test(html)) return 'script check';
  if (/blocked by network security/i.test(html)) return 'blocked by network security';
  if (/captcha|prove your humanity/i.test(html)) return 'captcha';
  return 'unknown page';
}

/** The parts of htmlparser2's nodes read here. */
interface DomLike {
  type: string;
  name?: string;
  attribs?: Record<string, string>;
  children?: DomLike[];
  data?: string;
}

const BLOCKS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'tr', 'figure']);

/** A rich-text block as plain text: paragraphs apart, quotes as `> `, list items as `- `, links written out. */
function nodeText(node: DomLike): string {
  if (node.type === 'text') return (node.data ?? '').replace(/\s+/g, ' ');
  if (node.type !== 'tag') return '';
  const name = node.name ?? '';
  const inner = (): string => (node.children ?? []).map(nodeText).join('');
  if (name === 'br') return '\n';
  if (name === 'hr') return '\n\n';
  if (name === 'img' || name === 'svg' || name === 'script' || name === 'style') return '';
  if (name === 'pre') return `\n\n${rawText(node).trim()}\n\n`;
  if (name === 'blockquote') return `\n\n${tidy(inner()).split('\n').map((line) => `> ${line}`.trimEnd()).join('\n')}\n\n`;
  if (name === 'li') return `\n- ${tidy(inner())}`;
  if (name === 'ul' || name === 'ol') return `\n\n${inner()}\n\n`;
  if (name === 'a') {
    const text = inner().trim();
    const href = node.attribs?.href ?? '';
    const absolute = /^https?:\/\//i.test(href) ? href : '';
    return absolute && absolute !== text ? `${text} (${absolute})` : text;
  }
  if (BLOCKS.has(name)) return `\n\n${inner().trim()}\n\n`;
  return inner();
}

function rawText(node: DomLike): string {
  if (node.type === 'text') return node.data ?? '';
  return (node.children ?? []).map(rawText).join('');
}

function tidy(text: string): string {
  return text.split('\n').map((line) => line.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function richText($: CheerioAPI, id: string): string {
  const el = $(`[id="${id}-post-rtjson-content"]`).first();
  const node = el.toArray()[0] as unknown as DomLike | undefined;
  return node ? tidy(nodeText(node)) : '';
}

function num(value: string | undefined): number {
  const n = Number(value ?? '');
  return Number.isFinite(n) ? n : 0;
}

function time(value: string | undefined): number {
  // `2026-10-11T17:25:17.563000+0000`: microseconds and a colon-less offset, which Date reads as neither.
  const iso = (value ?? '').replace(/(\.\d{3})\d+/, '$1').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

/** A Reddit media URL, or "": https, no credentials or port, one of `REDDIT_MEDIA_HOSTS`. */
export function redditMediaUrl(raw: string | undefined): string {
  try {
    const url = new URL(raw ?? '');
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    return (REDDIT_MEDIA_HOSTS as readonly string[]).includes(url.hostname.toLowerCase()) ? url.toString() : '';
  } catch {
    return '';
  }
}

/** `url 320w, url 640w` → copies, their height by the picture's own shape. */
function srcsetCopies(srcset: string | undefined, width: number, height: number): PhotoCopy[] {
  const copies: PhotoCopy[] = [];
  for (const part of (srcset ?? '').split(',')) {
    const [raw, size] = part.trim().split(/\s+/);
    const url = redditMediaUrl(raw);
    const w = Number(/^(\d+)w$/.exec(size ?? '')?.[1] ?? '');
    if (!url || !Number.isFinite(w) || w <= 0) continue;
    copies.push({ url, width: w, height: width > 0 && height > 0 ? Math.round((w * height) / width) : 0 });
  }
  return copies;
}

function photo(original: string, width: number, height: number, previews: PhotoCopy[]): XMedia {
  const known = width > 0 && height > 0;
  const originalCopy: PhotoCopy = known
    ? { url: original, width, height }
    : { url: original, width: UNSIZED_ORIGINAL_WIDTH, height: 0 };
  return {
    kind: 'photo',
    image: original,
    width: known ? width : 0,
    height: known ? height : 0,
    durationMs: 0,
    variants: [],
    copies: [...previews.filter((copy) => copy.width < originalCopy.width), originalCopy],
  };
}

function galleryImages($: CheerioAPI): XMedia[] {
  const items: XMedia[] = [];
  $('gallery-carousel li[slot^="page-"]').each((_, li) => {
    const slide = $(li);
    const original = redditMediaUrl(slide.find('zoomable-img img').first().attr('src'));
    if (!original) return;
    const img = slide.find('img[srcset], img[data-lazy-srcset]').first();
    const width = num(img.attr('width'));
    const height = num(img.attr('height'));
    items.push(photo(original, width, height, srcsetCopies(img.attr('srcset') ?? img.attr('data-lazy-srcset'), width, height)));
  });
  return items;
}

function singleImage($: CheerioAPI, contentHref: string): XMedia[] {
  const original = redditMediaUrl(contentHref);
  if (!original || !/^https:\/\/i\.redd\.it\//.test(original)) return [];
  const img = $('#post-image').first();
  // The shown copy's size gives the picture's shape, not the original's size.
  const copies = srcsetCopies(img.attr('srcset'), num(img.attr('width')), num(img.attr('height')));
  return [photo(original, 0, 0, copies)];
}

/** The ready mp4s of `packaged-media-json`: H.264 only (Telegram on iOS plays nothing else), highest bitrate first. */
export function packagedVariants(json: string | undefined): XVideoVariant[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json ?? '');
  } catch {
    return [];
  }
  const permutations = (parsed as { playbackMp4s?: { permutations?: unknown } } | null)?.playbackMp4s?.permutations;
  if (!Array.isArray(permutations)) return [];
  const variants: XVideoVariant[] = [];
  for (const entry of permutations as Array<{ source?: Record<string, unknown> }>) {
    const source = entry?.source ?? {};
    if (String(source.videoCodec ?? '').toUpperCase() !== 'H264') continue;
    const url = redditMediaUrl(typeof source.url === 'string' ? source.url : '');
    if (!url) continue;
    const dims = (source.dimensions ?? {}) as { width?: unknown; height?: unknown };
    variants.push({
      url,
      bitrate: typeof source.bitrateBps === 'number' ? source.bitrateBps : 0,
      width: typeof dims.width === 'number' ? dims.width : 0,
      height: typeof dims.height === 'number' ? dims.height : 0,
    });
  }
  return variants.sort((a, b) => b.bitrate - a.bitrate);
}

function packagedDurationMs(json: string | undefined): number {
  try {
    const seconds = (JSON.parse(json ?? '') as { playbackMp4s?: { duration?: unknown } } | null)?.playbackMp4s?.duration;
    return typeof seconds === 'number' && seconds > 0 ? Math.round(seconds * 1_000) : 0;
  } catch {
    return 0;
  }
}

/** The v.redd.it id of a video post: from `content-href`, else the player's playlist. */
function videoIdOf(contentHref: string, playerSrc: string | undefined): string {
  for (const raw of [contentHref, playerSrc ?? '']) {
    const id = /^https:\/\/v\.redd\.it\/([a-z0-9]+)/i.exec(raw)?.[1];
    if (id) return id.toLowerCase();
  }
  return '';
}

function videoMedia($: CheerioAPI, contentHref: string): RedditMedia {
  const player = $('shreddit-post shreddit-player').first();
  const videoId = videoIdOf(contentHref, player.attr('src'));
  if (!videoId) return { kind: 'none' };
  const json = player.attr('packaged-media-json');
  return {
    kind: 'video',
    videoId,
    poster: redditMediaUrl(player.attr('poster')),
    durationMs: packagedDurationMs(json),
    variants: packagedVariants(json),
  };
}

/**
 * The DASH manifest's H.264 renditions, each with the best AAC sound, as versions `x_media`
 * picks from and `postStream.ts` puts together; their size is (picture + sound) bitrate × length.
 * No AAC sound: the picture alone (a silent video).
 */
export function dashVariants(manifest: DashManifest, site: string): XVideoVariant[] {
  const videos = manifest.representations.filter((r) => r.contentType === 'video' && isH264(r.codecs) && r.plan.segments.length > 0);
  const audio = bestAacAudio(manifest.representations.filter((r) => r.contentType === 'audio' && r.plan.segments.length > 0));
  const audioBps = audio?.bandwidth ?? 0;
  return [...videos].sort((a, b) => b.bandwidth - a.bandwidth).map((video) => {
    const size = estimateBytes(video.bandwidth + audioBps, manifest.durationS);
    return {
      url: video.plan.segments[0].url,
      bitrate: video.bandwidth + audioBps,
      width: video.width ?? 0,
      height: video.height ?? 0,
      ...(size !== null ? { sizeBytes: size } : {}),
      stream: { site, video: video.plan, ...(audio ? { audio: audio.plan } : {}), hosts: ['v.redd.it'] },
    };
  });
}

function comments($: CheerioAPI): RedditComment[] {
  const out: RedditComment[] = [];
  $('shreddit-comment').each((_, el) => {
    if (out.length >= REDDIT_MAX_COMMENTS) return false;
    const c = $(el);
    const thing = c.attr('thingid') ?? '';
    const author = c.attr('author') ?? '';
    // The community's bot repeats its rules under every post: nothing to analyze.
    if (!thing || author === 'AutoModerator') return undefined;
    const text = richText($, thing);
    if (!text) return undefined;
    out.push({
      id: thing.replace(/^t1_/, ''),
      author,
      depth: num(c.attr('depth')),
      parentId: (c.attr('parentid') ?? '').replace(/^t1_/, ''),
      score: num(c.attr('score')),
      createdAt: time(c.attr('created')),
      text: Array.from(text).length > COMMENT_MAX_CHARS ? `${Array.from(text).slice(0, COMMENT_MAX_CHARS).join('')}…` : text,
      link: (c.attr('permalink') ?? '').startsWith('/') ? `${SITE}${c.attr('permalink')}` : '',
    });
    return undefined;
  });
  return out;
}

/** The post on a Reddit post page, or null when the page holds none. */
export function readRedditPage(html: string): RedditPage | null {
  const $ = load(html);
  const post = $('shreddit-post').first();
  if (post.length === 0) return null;
  const thing = post.attr('id') ?? '';
  const id = thing.replace(/^t3_/, '');
  if (!id) return null;
  const postType = post.attr('post-type') ?? '';
  const contentHref = post.attr('content-href') ?? '';
  const permalink = post.attr('permalink') ?? '';
  const link = permalink.startsWith('/') ? `${SITE}${permalink}` : `${SITE}/comments/${id}/`;
  let media: RedditMedia = { kind: 'none' };
  if (postType === 'gallery') media = { kind: 'images', items: galleryImages($) };
  else if (postType === 'image' || postType === 'gif') media = { kind: 'images', items: singleImage($, contentHref) };
  else if (postType === 'video') media = videoMedia($, contentHref);
  const external = /^https?:\/\//i.test(contentHref) && !/^https?:\/\/(?:[a-z0-9-]+\.)*(?:reddit\.com|redd\.it)\//i.test(contentHref);
  return {
    id,
    title: (post.attr('post-title') ?? '').trim(),
    author: post.attr('is-author-deleted') !== undefined ? '' : (post.attr('author') ?? ''),
    community: post.attr('subreddit-prefixed-name') ?? '',
    link,
    createdAt: time(post.attr('created-timestamp')),
    score: num(post.attr('score')),
    commentCount: num(post.attr('comment-count')),
    postType,
    body: richText($, thing),
    linkUrl: external ? contentHref : '',
    gated: post.attr('nsfw') !== undefined || post.attr('quarantined') !== undefined,
    media,
    comments: comments($),
  };
}

/** Who wrote it and where: `u/<name> · r/<community>`, the community alone for a deleted account. */
function byline(page: RedditPage): string {
  return [page.author ? `u/${page.author}` : '', page.community].filter(Boolean).join(' · ');
}

/** The post as the forward and the analysis read it: title, body, the linked page; `media` the reader's. */
export function redditPost(page: RedditPage, media: XMedia[]): XPost {
  return {
    id: page.id,
    author: '',
    name: byline(page),
    createdAt: page.createdAt,
    text: [page.title, page.body, page.linkUrl].filter(Boolean).join('\n\n'),
    link: page.link,
    image: media[0]?.image ?? '',
    replyCount: page.commentCount,
    likeCount: page.score,
    inReplyTo: '',
    isRepost: false,
    media,
    quoteMedia: [],
  };
}

/**
 * The comments as replies. The analysis reads who and what, so each one's name carries what a
 * Reddit thread adds to it: the score, and whom it answers when that comment is among them.
 */
export function redditReplies(page: RedditPage): XPost[] {
  const authors = new Map(page.comments.map((c) => [c.id, c.author]));
  return page.comments.map((c) => {
    const parent = c.depth > 0 ? authors.get(c.parentId) : undefined;
    const reply = c.depth > 0 ? (parent ? `reply to u/${parent}` : 'reply') : '';
    return {
      id: c.id,
      author: '',
      name: [`u/${c.author}`, `score ${c.score}`, reply].filter(Boolean).join(' · '),
      createdAt: c.createdAt,
      text: c.text,
      link: c.link || page.link,
      image: '',
      replyCount: 0,
      likeCount: c.score,
      inReplyTo: c.depth > 0 ? c.parentId : '',
      isRepost: false,
      media: [],
      quoteMedia: [],
    };
  });
}
