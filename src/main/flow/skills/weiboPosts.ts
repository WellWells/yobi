import type { PhotoCopy } from '../../../shared/xMedia';
import { weiboPostUrl } from '../../../shared/linkSites/weiboLinks';
import { arr, obj, str, type Json } from './jsonPick';
import type { XMedia, XPost, XVideoVariant } from './xPosts';

/*
 * Parsing what Weibo's web API answers a visitor: the visitor cookie, the video page's post id, a
 * post (`/ajax/statuses/show`) and a page of its comments (`/ajax/statuses/buildComments`). Only
 * H.264 video versions are kept, so Telegram on iOS can play them.
 */

/** Counts arrive as numbers or numeric strings, depending on the field. */
function count(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return 0;
}

/**
 * The visitor cookie `passport.weibo.com/visitor/genvisitor2` hands out, as a `Cookie` header
 * (`SUB` and `SUBP`); null when the answer has another shape.
 */
export function weiboVisitorCookie(text: string): string | null {
  const json = /\((\{[\s\S]*\})\)\s*;?\s*$/.exec(text.trim())?.[1];
  if (!json) return null;
  let body: Json | undefined;
  try {
    body = obj(JSON.parse(json));
  } catch {
    return null;
  }
  const data = obj(body?.data);
  const sub = str(data?.sub);
  const subp = str(data?.subp);
  const safe = /^[\w.\-*!~%]+$/;
  if (!safe.test(sub) || !safe.test(subp)) return null;
  return `SUB=${sub}; SUBP=${subp}`;
}

/**
 * The id of the post a video page belongs to, from the video API's answer; null when the video is
 * not there (the API answers `Component_Play_Playinfo: null`). Read from the text: the number is
 * past what a JSON number keeps exactly, once ids grow.
 */
export function weiboVideoMid(text: string): string | null {
  let body: Json | undefined;
  try {
    body = obj(JSON.parse(text));
  } catch {
    return null;
  }
  if (!obj(obj(body?.data)?.Component_Play_Playinfo)) return null;
  return /"mid"\s*:\s*"?(\d{15,17})\b/.exec(text)?.[1] ?? null;
}

/** Weibo's media hosts: its picture servers and its video CDN. */
export function isWeiboMediaHost(host: string): boolean {
  return /(?:^|\.)(?:sinaimg\.cn|weibocdn\.com)$/i.test(host);
}

/** An https URL on a Weibo media host; "" for anything else. `//…` and `http:` are taken as https. */
function mediaUrl(value: unknown): string {
  const raw = str(value).trim();
  if (!raw) return '';
  const withScheme = raw.startsWith('//') ? `https:${raw}` : raw.replace(/^http:\/\//i, 'https://');
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    return isWeiboMediaHost(url.hostname) ? url.toString() : '';
  } catch {
    return '';
  }
}

/** A picture's sizes, smallest to largest; the cropped cover copy (`largecover`) is not one of them. */
const PICTURE_SIZES = ['thumbnail', 'bmiddle', 'large', 'original', 'mw2000', 'largest'] as const;

/**
 * A picture of a post (`pic_infos[<id>]`, or a mixed post's picture item). A Live Photo is its
 * still and a GIF its file: neither has an mp4 the chat would play as more.
 */
function photoMedia(info: Json): XMedia | null {
  const seen = new Set<string>();
  const copies: PhotoCopy[] = [];
  for (const size of PICTURE_SIZES) {
    const copy = obj(info[size]);
    const url = mediaUrl(copy?.url);
    const width = count(copy?.width);
    const height = count(copy?.height);
    if (!url || seen.has(url) || width <= 0 || height <= 0) continue;
    seen.add(url);
    copies.push({ url, width, height });
  }
  const biggest = [...copies].sort((a, b) => b.width - a.width)[0];
  if (!biggest) return null;
  return { kind: 'photo', image: biggest.url, width: biggest.width, height: biggest.height, durationMs: 0, variants: [], copies };
}

/** Whether a version's codec is H.264; one that names none is taken as the mp4 it says it is. */
function isH264(codecs: string): boolean {
  return codecs === '' || codecs.toLowerCase().startsWith('avc1');
}

function playbackVariants(media: Json): XVideoVariant[] {
  const seen = new Set<string>();
  const variants: XVideoVariant[] = [];
  for (const raw of arr(media.playback_list)) {
    const play = obj(obj(raw)?.play_info);
    if (!play || str(play.mime) !== 'video/mp4' || !isH264(str(play.video_codecs))) continue;
    const url = mediaUrl(play.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const size = count(play.size);
    variants.push({
      url,
      bitrate: count(play.bitrate),
      width: count(play.width),
      height: count(play.height),
      ...(size > 0 ? { sizeBytes: size } : {}),
    });
  }
  return variants.sort((a, b) => b.bitrate - a.bitrate || b.height - a.height);
}

/**
 * A post without the version list still names its mp4s by quality — often all three the same
 * file. The picture size is the URL's own `template=<w>x<h>`, not the field's name.
 */
const FALLBACK_VERSIONS = ['mp4_720p_mp4', 'mp4_hd_url', 'mp4_sd_url'] as const;

function namedVariants(media: Json): XVideoVariant[] {
  const seen = new Set<string>();
  const variants = FALLBACK_VERSIONS.flatMap((key): XVideoVariant[] => {
    const url = mediaUrl(media[key]);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    const [, width = '0', height = '0'] = /^(\d+)x(\d+)/.exec(new URL(url).searchParams.get('template') ?? '') ?? [];
    return [{ url, bitrate: 0, width: Number(width), height: Number(height) }];
  });
  return variants.sort((a, b) => Math.min(b.width, b.height) - Math.min(a.width, a.height));
}

function posterCopies(media: Json): PhotoCopy[] {
  const big = obj(media.big_pic_info);
  const seen = new Set<string>();
  return ['pic_small', 'pic_middle', 'pic_big'].flatMap((key): PhotoCopy[] => {
    const copy = obj(big?.[key]);
    const url = mediaUrl(copy?.url);
    const width = count(copy?.width);
    const height = count(copy?.height);
    if (!url || seen.has(url) || width <= 0 || height <= 0) return [];
    seen.add(url);
    return [{ url, width, height }];
  });
}

/**
 * The video a `page_info` (or a mixed post's video item) carries; null for any other kind of card
 * (an article, a link) and for a video with no H.264 version.
 */
function videoMedia(page: Json): XMedia | null {
  if (str(page.object_type) !== 'video') return null;
  const media = obj(page.media_info);
  if (!media) return null;
  const listed = playbackVariants(media);
  const variants = listed.length > 0 ? listed : namedVariants(media);
  if (variants.length === 0) return null;
  const copies = posterCopies(media);
  const image = copies.at(-1)?.url || mediaUrl(page.page_pic);
  const best = variants[0];
  return {
    kind: 'video',
    image,
    width: best.width,
    height: best.height,
    durationMs: Math.round(count(media.duration) * 1_000),
    variants,
    ...(copies.length > 0 ? { copies } : {}),
  };
}

/** A post's pictures and videos in the order it shows them. */
function postMedia(status: Json): XMedia[] {
  const mixed = arr(obj(status.mix_media_info)?.items);
  if (mixed.length > 0) {
    return mixed.flatMap((raw) => {
      const item = obj(raw);
      const data = obj(item?.data);
      if (!data) return [];
      const media = str(item?.type) === 'video' ? videoMedia(data) : photoMedia(data);
      return media ? [media] : [];
    });
  }
  const infos = obj(status.pic_infos) ?? {};
  const photos = arr(status.pic_ids).flatMap((id) => {
    const info = obj(infos[str(id)]);
    const media = info ? photoMedia(info) : null;
    return media ? [media] : [];
  });
  const page = obj(status.page_info);
  const video = page ? videoMedia(page) : null;
  return video ? [...photos, video] : photos;
}

/** The page ids of a post's own videos: the short links in its text that only point at them. */
function ownVideoPages(status: Json): Set<string> {
  const pages = [obj(status.page_info), ...arr(obj(status.mix_media_info)?.items).map((raw) => obj(obj(raw)?.data))];
  return new Set(pages.flatMap((page) => (page && str(page.object_type) === 'video' && str(page.page_id) ? [str(page.page_id)] : [])));
}

/**
 * The post's text as its author wrote it: the full text of a long post, `t.cn` short links
 * expanded, the one that only points at the post's own video cut (as X's trailing media link is),
 * and the zero-width spaces Weibo ends every post with dropped.
 */
function postText(status: Json): string {
  let text = str(obj(status.longText)?.content) || str(status.text_raw);
  const own = ownVideoPages(status);
  for (const raw of arr(status.url_struct)) {
    const link = obj(raw);
    const short = str(link?.short_url);
    if (!link || !/^https?:\/\/t\.cn\//i.test(short)) continue;
    if (own.has(str(link.page_id))) {
      text = text.split(short).join('');
      continue;
    }
    const long = str(link.long_url);
    if (/^https?:\/\//i.test(long)) text = text.split(short).join(long);
  }
  return text.replace(/​/g, '').replace(/[ \t]+$/gm, '').trim();
}

function createdAt(status: Json): number {
  const at = Date.parse(str(status.created_at));
  return Number.isFinite(at) ? at : 0;
}

/** The post a `retweeted_status` names, as the quote under a repost: "> name: text". */
function quoted(original: Json): string {
  const name = str(obj(original.user)?.screen_name);
  const text = postText(original);
  if (!text) return '';
  const lines = `${name ? `${name}: ` : ''}${text}`.split('\n');
  return lines.map((line) => `> ${line}`).join('\n');
}

/**
 * The post `/ajax/statuses/show` answers. A repost quotes the original under its own text, the
 * original's pictures and video in `quoteMedia`. A video with no H.264 version comes with no
 * media: the text still goes, and the forward says the post has none to send.
 */
export function weiboPost(status: Json): XPost {
  const user = obj(status.user);
  const uid = str(user?.idstr);
  const id = str(status.idstr) || str(status.mid);
  const bid = str(status.mblogid);
  const original = obj(status.retweeted_status);
  const quote = original ? quoted(original) : '';
  const media = postMedia(status);
  const quoteMedia = original ? postMedia(original) : [];
  const first = media[0] ?? quoteMedia[0];
  return {
    id,
    author: '',
    name: str(user?.screen_name),
    createdAt: createdAt(status),
    text: [postText(status), quote].filter(Boolean).join('\n\n'),
    link: weiboPostUrl(bid || id, uid),
    image: first ? (first.copies?.at(-1)?.url ?? first.image) : '',
    replyCount: count(status.comments_count),
    likeCount: count(status.attitudes_count),
    inReplyTo: '',
    isRepost: original !== undefined,
    media,
    quoteMedia,
  };
}

/** What the post API says about a post it will not show; null when it showed one. */
export function weiboPostError(body: Json): { missing: boolean; message: string } | null {
  if (str(body.idstr) || str(body.mid)) return null;
  // 20101: "该微博不存在" — removed, or never there.
  return { missing: count(body.error_code) === 20101, message: str(body.message) || str(body.msg) };
}

export interface WeiboCommentPage {
  comments: XPost[];
  /** Where the next page starts (`max_id`); null when there is none. */
  next: string | null;
}

/** One page of `/ajax/statuses/buildComments`: the top-level comments with text, in the site's order. */
export function readWeiboComments(body: unknown, postLink: string): WeiboCommentPage {
  const answer = obj(body);
  const comments = arr(answer?.data).flatMap((raw): XPost[] => {
    const comment = obj(raw);
    const id = str(comment?.idstr);
    const text = str(comment?.text_raw).replace(/​/g, '').trim();
    if (!comment || !id || !text) return [];
    return [{
      id,
      author: '',
      name: str(obj(comment.user)?.screen_name),
      createdAt: createdAt(comment),
      text,
      link: postLink,
      image: '',
      replyCount: count(comment.total_number),
      likeCount: count(comment.like_counts),
      inReplyTo: '',
      isRepost: false,
      media: [],
      quoteMedia: [],
    }];
  });
  const next = answer?.max_id;
  const more = (typeof next === 'number' && Number.isSafeInteger(next) && next > 0) || (typeof next === 'string' && /^[1-9]\d*$/.test(next));
  return { comments, next: more ? String(next) : null };
}
