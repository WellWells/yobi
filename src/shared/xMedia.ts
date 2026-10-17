import { expandableQuote } from './expandableQuote';
import { isAccountPost, isMediaOnlyPost, matchPostLink } from './linkSites/rows';
import type { PostSiteId } from './linkSites/types';
import { isGeminiApiBaseUrl, buildByokGroupUrl, buildByokUrl } from './types';
import { TELEGRAM_UPLOAD_LIMIT_BYTES } from './ytdl';

/**
 * Where an `x_media` step puts what it fetched. `preview` is the desktop chat's own: the version a
 * Telegram chat would get, kept where the chat shows it rather than in the Downloads folder —
 * saving it there is a button.
 */
export type XMediaDestination = 'telegram' | 'line' | 'local' | 'preview';

/** LINE fetches a video from its URL itself, up to 200 MB. */
export const LINE_VIDEO_LIMIT_BYTES = 200_000_000;

/** Gemini fetches a video URL itself only up to 15 MB. */
export const GEMINI_URL_VIDEO_LIMIT_BYTES = 15_000_000;

/**
 * Telegram's caption limit is 1,024 visible characters after formatting; a little under it, since
 * the count here is of the Markdown source.
 */
export const TELEGRAM_CAPTION_CHARS = 1_000;

/** Where a post lives. A Threads, Instagram, Facebook, TikTok, PTT, Dcard or Reddit post is read and forwarded exactly as an X post is. */
export type PostSource = PostSiteId;

export interface XMediaInput {
  source: PostSource;
  /** The post's link, rebuilt from its id: nothing else the person typed reaches a request. */
  url: string;
  id: string;
  author: string;
  /** What the person wrote besides the link; "" for a bare link. */
  prompt: string;
}

/**
 * An Instagram story, an account's stories or a highlight: media only, no caption or comments
 * to analyze. The link-site row's `mediaOnly` decides.
 */
export function isStoryLink(input: Pick<XMediaInput, 'source' | 'url'>): boolean {
  return isMediaOnlyPost(input.source, input.url);
}

/** An Instagram profile: its menu lists the account's posts, its "analyze" sums up the account. The row's `account` decides. */
export function isAccountLink(input: Pick<XMediaInput, 'source' | 'url'>): boolean {
  return isAccountPost(input.source, input.url);
}

/**
 * The first X, Threads, Instagram, Facebook, TikTok, PTT, Dcard or Reddit post link in `text` and the words around it; null
 * when there is none. The sites and their order are the link-site table's post rows.
 */
export function parseXMediaInput(text: string): XMediaInput | null {
  const match = matchPostLink(text);
  if (!match) return null;
  const { site, url, id, author } = match.ref;
  return { source: site, url, id, author, prompt: match.prompt };
}

/** `auto` follows whoever started the run: a Telegram or LINE chat gets that chat, anything else this computer. */
export function resolveXMediaDestination(raw: string | undefined, triggerPlatform: string | undefined): XMediaDestination {
  const choice = (raw ?? '').trim().toLowerCase();
  if (choice === 'telegram' || choice === 'line' || choice === 'local' || choice === 'preview') return choice;
  const platform = (triggerPlatform ?? '').trim().toLowerCase();
  return platform === 'telegram' || platform === 'line' ? platform : 'local';
}

/**
 * The largest file each destination takes; null means no limit. A Telegram chat takes what main
 * works out for the person (`telegramLimitBytes`: their cap, and what the bot can send now),
 * else the Bot API's own limit; the desktop preview keeps to that one.
 */
export function destinationLimitBytes(destination: XMediaDestination, telegramLimitBytes = TELEGRAM_UPLOAD_LIMIT_BYTES): number | null {
  if (destination === 'telegram') return telegramLimitBytes;
  if (destination === 'preview') return TELEGRAM_UPLOAD_LIMIT_BYTES;
  if (destination === 'line') return LINE_VIDEO_LIMIT_BYTES;
  return null;
}

export interface SizedVariant {
  url: string;
  bitrate: number;
  height: number;
  /** From the server; null when it did not say. */
  sizeBytes: number | null;
}

/**
 * The size to judge a version by: the server's when it said, else bitrate × length with a margin
 * for the container, which runs a few percent over the nominal bitrate.
 */
export function variantBytes(variant: SizedVariant, durationMs: number): number | null {
  if (variant.sizeBytes !== null) return variant.sizeBytes;
  if (variant.bitrate <= 0 || durationMs <= 0) return null;
  return Math.ceil((variant.bitrate * durationMs) / 8_000 * 1.15);
}

/**
 * The best version within `limitBytes` (any size when null). One whose size cannot be told is taken
 * only when nothing else is known: a GIF has a single version and no bitrate.
 */
export function pickVariant<V extends SizedVariant>(variants: readonly V[], durationMs: number, limitBytes: number | null): V | null {
  const byQuality = [...variants].sort((a, b) => b.bitrate - a.bitrate || b.height - a.height);
  if (limitBytes === null) return byQuality[0] ?? null;
  const fits = byQuality.find((v) => {
    const bytes = variantBytes(v, durationMs);
    return bytes !== null && bytes <= limitBytes;
  });
  if (fits) return fits;
  return byQuality.every((v) => variantBytes(v, durationMs) === null) ? byQuality[0] ?? null : null;
}

/** The smallest version Gemini can fetch from its URL, for reading what the video says. */
export function smallestReadable<V extends SizedVariant>(variants: readonly V[], durationMs: number): V | null {
  const bySize = [...variants].sort((a, b) => a.bitrate - b.bitrate || a.height - b.height);
  return bySize.find((v) => {
    const bytes = variantBytes(v, durationMs);
    return bytes !== null && bytes <= GEMINI_URL_VIDEO_LIMIT_BYTES;
  }) ?? null;
}

export type PhotoSize = 'small' | 'medium' | 'large' | 'orig';

/**
 * pbs.twimg.com serves a photo at several sizes by `?name=`; the URL keeps its own extension.
 * Any other host's URL is signed and goes as it is.
 */
export function photoAtSize(url: string, size: PhotoSize): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'pbs.twimg.com') return url;
    parsed.search = '';
    parsed.searchParams.set('name', size);
    return parsed.toString();
  } catch {
    return url;
  }
}

/** A ready-made copy of a photo, where the host serves fixed sizes rather than resizing by URL (Threads). */
export interface PhotoCopy {
  url: string;
  width: number;
  height: number;
}

/**
 * The widest copy each size takes. A LINE photo is its own preview, which LINE caps at 1 MB, so
 * `medium` stays near X's 1,200 px; `small` is a LINE video's preview.
 */
const COPY_MAX_WIDTH: Record<PhotoSize, number> = { small: 480, medium: 1_080, large: 2_560, orig: Infinity };

/** A photo or poster at `size`: the widest copy that fits it when the post came with copies, else by `?name=`. */
export function photoUrl(media: { image: string; copies?: readonly PhotoCopy[] }, size: PhotoSize): string {
  const copies = [...(media.copies ?? [])].sort((a, b) => b.width - a.width);
  if (copies.length === 0) return photoAtSize(media.image, size);
  return (copies.find((c) => c.width <= COPY_MAX_WIDTH[size]) ?? copies[copies.length - 1]).url;
}

const BARE_URL = /https?:\/\/\S+/g;

/**
 * Markdown in a post's text is the author's punctuation, not formatting ("f*cking … *sigh*").
 * Links stay as they are — an escape inside one would end up in the address — and so does `>`,
 * which starts the quoted post's block.
 */
export function escapePostMarkdown(text: string): string {
  const escape = (part: string): string => part.replace(/([\\`*_[\]~])/g, '\\$1');
  let out = '';
  let last = 0;
  for (const match of text.matchAll(BARE_URL)) {
    out += escape(text.slice(last, match.index)) + match[0];
    last = (match.index ?? 0) + match[0].length;
  }
  return out + escape(text.slice(last));
}

export interface XMessageParts {
  name: string;
  author: string;
  text: string;
  link: string;
  /** The post's own opening block, already Markdown (a PTT article's header): it says who wrote it. */
  heading?: string | undefined;
}

/** A post's text past this many lines or characters goes to Telegram folded; a short one reads better open. */
const FOLD_MIN_LINES = 5;
const FOLD_MIN_CHARS = 250;

/** Whether Telegram gets the post's text folded (every post site, the text only). */
export function foldsInTelegram(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.split('\n').length > FOLD_MIN_LINES || Array.from(trimmed).length > FOLD_MIN_CHARS;
}

/**
 * The post as a chat message: who wrote it (or its own opening block), what it says, the link.
 * `fold` (Telegram) puts a long text in a folded quote; who wrote it and the link stay outside.
 */
export function xPostMessage(post: XMessageParts, fold = false): string {
  const who = post.name && post.author ? `${post.name} (@${post.author})` : post.author ? `@${post.author}` : post.name;
  const opening = post.heading?.trim() ? post.heading : escapePostMarkdown(who);
  const text = escapePostMarkdown(post.text);
  const body = fold && foldsInTelegram(post.text) ? expandableQuote(text.trim()) : text;
  return [opening, body, post.link].filter((part) => part.trim()).join('\n\n');
}

/**
 * The message for under the media and what does not fit there. Telegram captions stop at 1,024
 * characters: a longer post goes out as its own message first and the caption keeps only who and
 * the link. With no media there is no caption — the message goes as text — and LINE and the
 * computer have no caption limit worth the name. Telegram gets a long text folded.
 */
export function splitCaption(post: XMessageParts, destination: XMediaDestination, hasMedia: boolean): { caption: string; overflow: string } {
  const message = xPostMessage(post, destination === 'telegram');
  if (!hasMedia || destination !== 'telegram' || Array.from(message).length <= TELEGRAM_CAPTION_CHARS) {
    return { caption: message, overflow: '' };
  }
  return { caption: xPostMessage({ ...post, text: '' }), overflow: message };
}

interface ByokEntry {
  id: string;
  baseUrl: string;
  apiKey?: string;
}

/** `auto`: the first group holding a Gemini API key, else the first Gemini API key; "" when there is none. */
export function autoGeminiReader(instances: readonly ByokEntry[], groups: ReadonlyArray<{ id: string; memberIds: string[] }>): string {
  const gemini = instances.filter((i) => isGeminiApiBaseUrl(i.baseUrl) && (i.apiKey ?? 'set') !== '');
  const ids = new Set(gemini.map((i) => i.id));
  const group = groups.find((g) => g.memberIds.some((id) => ids.has(id)));
  if (group) return buildByokGroupUrl(group.id);
  return gemini[0] ? buildByokUrl(gemini[0].id) : '';
}
