/*
 * bilibili video links: `www.`/`m.bilibili.com/video/<BV id or av number>`, with an optional part
 * (`?p=2`), and `b23.tv/<code>` share links. Only single videos: anime (`bangumi/`), paid courses
 * (`cheese/`), live rooms (`live.`), channels (`space.`) and event pages (`festival/`) are not this
 * row's, so such a link reaches the agent like any other. The international site (bilibili.tv) is
 * not taken either. A list of videos (`list/`, `medialist/`, a collection on someone's page) is
 * read apart (`parseBilibiliListUrl`): taken only to answer that downloads go one at a time,
 * unless the list player names the video it plays (`?bvid=`), which is then that one video.
 *
 * Every other query parameter is dropped, since a shared link carries the sharer's tracking ids;
 * only `p` stays, and only when it is above 1.
 */

/**
 * The title block bilibili's share button (app and web) writes before the link: one `【…】` block
 * whose title ends with the site's name, in Chinese or Latin script (any separator before it is
 * part of the title); a block without it is the person's own words.
 */
export const BILIBILI_SHARE_TITLE = /【[^【】\r\n]*?(?:哔哩哔哩|嗶哩嗶哩|bilibili)(?:_bilibili)?\s*】/i;

/** The hosts whose `/video/…` pages are this row's. */
const VIDEO_HOSTS = new Set(['bilibili.com', 'www.bilibili.com', 'm.bilibili.com']);
/** The share host: its code resolves to the page with a redirect, read later (`info`). */
const SHORT_HOSTS = new Set(['b23.tv', 'www.b23.tv']);

/** `BV1` and nine base58 characters. */
const BV_ID = /^BV1[1-9A-HJ-NP-Za-km-z]{9}$/;
/**
 * A language segment may come first: since 2026-10 the site sends a video page to `/zh-Hant/video/…`
 * for visitors in Taiwan, so that is also what such a visitor copies from the address bar.
 */
const VIDEO_PATH = /^\/(?:[a-z]{2}(?:-[a-z]{2,4})?\/)?video\/(BV1[1-9A-HJ-NP-Za-km-z]{9}|av\d{1,12})\/?$/i;
const SHORT_PATH = /^\/([A-Za-z0-9]{4,16})\/?$/;
/** A `p` above this is not read as a part number. */
const MAX_PART = 1_000;

export type BilibiliLink =
  /** One video, the link rebuilt as `https://www.bilibili.com/video/<id>/` (+ `?p=N`). */
  | { kind: 'video'; id: string; part: number; url: string }
  /** A `b23.tv` share code, not yet resolved. */
  | { kind: 'short'; id: string; url: string };

/** The canonical page of a video (or of its part `part`, when above 1). */
export function bilibiliVideoUrl(id: string, part = 1): string {
  return `https://www.bilibili.com/video/${id}/${part > 1 ? `?p=${part}` : ''}`;
}

/** A BV id as bilibili writes it; an `av` number lower-cased. */
function normalizeId(raw: string): string {
  return BV_ID.test(raw) ? raw : raw.toLowerCase();
}

function partOf(url: URL): number {
  const raw = url.searchParams.get('p') ?? '';
  if (!/^\d{1,4}$/.test(raw)) return 1;
  const part = Number(raw);
  return part >= 1 && part <= MAX_PART ? part : 1;
}

/**
 * A bilibili video link or share link; null for anything else, the excluded pages included. Only
 * http(s) links with no user, password or port, as the YouTube row takes them.
 */
export function parseBilibiliUrl(text: string): BilibiliLink | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (SHORT_HOSTS.has(host)) {
    const code = SHORT_PATH.exec(url.pathname)?.[1];
    return code ? { kind: 'short', id: code, url: `https://b23.tv/${code}` } : null;
  }
  if (!VIDEO_HOSTS.has(host)) return null;
  const raw = VIDEO_PATH.exec(url.pathname)?.[1];
  if (!raw) return null;
  const id = normalizeId(raw);
  const part = partOf(url);
  return { kind: 'video', id, part, url: bilibiliVideoUrl(id, part) };
}

/** A list of videos: its own id and its page, rebuilt from the parts read. */
export interface BilibiliListLink {
  id: string;
  url: string;
}

/** A list page on the main site: a favourites or collection player (`list/`), an old `medialist/` page. */
const LIST_PATH = /^\/(list|medialist\/(?:play|detail))\/([\w-]{1,40})\/?$/i;
/** A collection or series on someone's page: `<mid>/lists/<id>`, or the old `<mid>/channel/<kind>detail?sid=<id>`. */
const SPACE_LIST_PATH = /^\/(\d{1,20})\/lists\/(\d{1,20})\/?$/;
const SPACE_CHANNEL_PATH = /^\/(\d{1,20})\/channel\/(collectiondetail|seriesdetail)\/?$/i;
const SPACE_HOST = 'space.bilibili.com';

/**
 * A link to a whole list of videos rather than one: a `list/` or `medialist/` page, or a
 * collection or series on someone's page. Someone's page itself and its other tabs are not
 * lists. Null for anything else; the same http(s), no user, password or port as a video link.
 */
export function parseBilibiliListUrl(text: string): BilibiliListLink | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (VIDEO_HOSTS.has(host)) {
    const found = LIST_PATH.exec(url.pathname);
    if (!found) return null;
    const page = found[1].toLowerCase();
    return { id: found[2], url: `https://www.bilibili.com/${page}/${found[2]}` };
  }
  if (host !== SPACE_HOST) return null;
  const list = SPACE_LIST_PATH.exec(url.pathname);
  if (list) return { id: list[2], url: `https://${SPACE_HOST}/${list[1]}/lists/${list[2]}` };
  const channel = SPACE_CHANNEL_PATH.exec(url.pathname);
  const sid = url.searchParams.get('sid') ?? '';
  if (!channel || !/^\d{1,20}$/.test(sid)) return null;
  return { id: sid, url: `https://${SPACE_HOST}/${channel[1]}/channel/${channel[2].toLowerCase()}?sid=${sid}` };
}

/**
 * The video a list player names (`list/<id>?bvid=<BV id>`, as the page's address bar shows while
 * it plays one video of the list): that video's BV id, else null. Someone's page never names one.
 */
export function bilibiliListVideoId(text: string): string | null {
  if (!parseBilibiliListUrl(text)) return null;
  const url = new URL(text.trim());
  if (!VIDEO_HOSTS.has(url.hostname.toLowerCase())) return null;
  const bvid = url.searchParams.get('bvid') ?? '';
  return BV_ID.test(bvid) ? bvid : null;
}

/**
 * Where a share link led, read as a video: null when it is not one (an anime episode, a live
 * room, another share link, another site). A resolved link is never resolved again.
 */
export function parseResolvedBilibiliUrl(location: string): Extract<BilibiliLink, { kind: 'video' }> | null {
  const link = parseBilibiliUrl(location);
  return link?.kind === 'video' ? link : null;
}
