/*
 * Weibo post links: a post on weibo.com (`/<uid>/<bid or mid>`, `/detail/<id>`, `/status/<id>`),
 * on the mobile site (`m.weibo.cn/status/<id>`, `/detail/<id>`, `/<uid>/<id>`), the app's share
 * page (`share.api.weibo.cn/share/<n>,<mid>.html`), and a video page (`weibo.com/tv/show/1034:<id>`,
 * `video.weibo.com/show?fid=1034:<id>`). A post's id is its `bid` (nine letters and digits, the
 * one weibo.com shows) or its `mid` (sixteen digits): the post API takes either. A video page's id
 * is the video's, not its post's; the reader looks the post up.
 *
 * Accounts, topics, searches and `t.cn` links (Weibo's shortener, which leads anywhere) are not
 * this row's: such a link reaches the agent like any other. Every query parameter but the video
 * page's `fid` is dropped, and the link is rebuilt from its id.
 */

const WEB_HOSTS = new Set(['weibo.com', 'www.weibo.com']);
const MOBILE_HOSTS = new Set(['m.weibo.cn']);
const VIDEO_HOST = 'video.weibo.com';
const SHARE_HOST = 'share.api.weibo.cn';

/** A post's `mid`: sixteen digits today; older posts have fewer. */
const MID = '\\d{15,17}';
/** A post's `bid`: base62, nine characters, never all digits. */
const BID = '(?=[0-9A-Za-z]*[A-Za-z])[0-9A-Za-z]{8,10}';
const POST_ID = `${MID}|${BID}`;
/** An account's numeric uid. */
const UID = '\\d{5,11}';
/** Weibo's object type for a video ("1034:" before its id). */
const VIDEO_TYPE = '1034';

const WEB_POST = new RegExp(`^/(${UID})/(${POST_ID})/?$`);
const DETAIL_POST = new RegExp(`^/(?:detail|status)/(${POST_ID})/?$`);
const TV_SHOW = new RegExp(`^/tv/show/${VIDEO_TYPE}:(\\d{10,20})/?$`);
const VIDEO_FID = new RegExp(`^${VIDEO_TYPE}:(\\d{10,20})$`);
const SHARE_PAGE = new RegExp(`^/share/\\d+,(${MID})\\.html$`);

export type WeiboLink =
  /** One post by its bid or mid; `author` the uid when the link named one. */
  | { kind: 'post'; id: string; author: string; url: string }
  /** A video page by the video's own id: its post is looked up when read. */
  | { kind: 'video'; id: string; author: ''; url: string };

/** A post's link as weibo.com shows it: under its author's uid when known. */
export function weiboPostUrl(id: string, uid = ''): string {
  return uid ? `https://weibo.com/${uid}/${id}` : `https://m.weibo.cn/status/${id}`;
}

/** A video's page on weibo.com. */
export function weiboVideoUrl(id: string): string {
  return `https://weibo.com/tv/show/${VIDEO_TYPE}:${id}`;
}

/** The video's object id the video API takes (`1034:<id>`). */
export function weiboVideoObjectId(id: string): string {
  return `${VIDEO_TYPE}:${id}`;
}

function post(id: string, uid: string): WeiboLink {
  return { kind: 'post', id, author: uid, url: weiboPostUrl(id, uid) };
}

function video(id: string): WeiboLink {
  return { kind: 'video', id, author: '', url: weiboVideoUrl(id) };
}

/**
 * A Weibo post or video link; null for anything else. http(s) with no user, password or port;
 * the scheme may be left out, as every post row takes it.
 */
export function parseWeiboUrl(raw: string): WeiboLink | null {
  const trimmed = raw.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  const { pathname } = url;
  if (host === VIDEO_HOST) {
    if (!/^\/show\/?$/.test(pathname)) return null;
    const id = VIDEO_FID.exec(url.searchParams.get('fid') ?? '')?.[1];
    return id ? video(id) : null;
  }
  if (host === SHARE_HOST) {
    const id = SHARE_PAGE.exec(pathname)?.[1];
    return id ? post(id, '') : null;
  }
  if (!WEB_HOSTS.has(host) && !MOBILE_HOSTS.has(host)) return null;
  const tv = WEB_HOSTS.has(host) ? TV_SHOW.exec(pathname)?.[1] : undefined;
  if (tv) return video(tv);
  const detail = DETAIL_POST.exec(pathname)?.[1];
  if (detail) return post(detail, '');
  const found = WEB_POST.exec(pathname);
  return found ? post(found[2], found[1]) : null;
}
