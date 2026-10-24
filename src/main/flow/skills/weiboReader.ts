import { sendLog } from '../../helpers';
import { userAgentForUrl } from '../../userAgent';
import { parseWeiboUrl, weiboVideoObjectId } from '../../../shared/linkSites/weiboLinks';
import { FlowUserError } from '../userError';
import { obj } from './jsonPick';
import { readWeiboComments, weiboPost, weiboPostError, weiboVideoMid, weiboVisitorCookie } from './weiboPosts';
import type { XPost, XThread } from './xPosts';
import type { XRead } from './xReader';

/*
 * Reads a Weibo link signed out, through the JSON API weibo.com's own pages call, as a visitor:
 * Weibo hands any browser a visitor cookie (`SUB`/`SUBP`, from passport.weibo.com) and answers
 * its API with it. The API also wants a weibo.com `Referer`, which is why these are Node requests
 * (Electron's `net` will not send one set by hand). The cookie lives in memory only; no sign-in
 * is ever used (Yobi has no Weibo sign-in).
 */

const ORIGIN = 'https://weibo.com';
const REFERER = `${ORIGIN}/`;
const VISITOR_URL = 'https://passport.weibo.com/visitor/genvisitor2';
const REQUEST_TIMEOUT_MS = 20_000;

/** Comments read for the analysis: two pages of 20. */
const MAX_COMMENT_PAGES = 2;
const MAX_COMMENTS = 40;

/** The visitor cookie this run got, until Weibo stops taking it. */
let visitor: string | null = null;

interface ApiAnswer {
  status: number;
  text: string;
}

function requestSignal(signal: AbortSignal | undefined): AbortSignal {
  return AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...(signal ? [signal] : [])]);
}

async function visitorCookie(signal: AbortSignal | undefined): Promise<string> {
  if (visitor) return visitor;
  const res = await fetch(VISITOR_URL, {
    method: 'POST',
    headers: { 'User-Agent': userAgentForUrl(VISITOR_URL), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'cb=visitor_gray_callback&tid=&from=weibo',
    redirect: 'manual',
    signal: requestSignal(signal),
  });
  const cookie = res.ok ? weiboVisitorCookie(await res.text()) : null;
  if (!cookie) {
    throw new FlowUserError('flow.error.xPageUnreadable', { url: ORIGIN }, `Weibo gave no visitor cookie (HTTP ${res.status}; the site may have changed it)`);
  }
  visitor = cookie;
  return cookie;
}

/**
 * One API request with the visitor cookie. A redirect (to the visitor page or the sign-in) means
 * Weibo no longer takes the cookie: a new one is asked for, once.
 */
async function api(url: string, signal: AbortSignal | undefined, form?: string): Promise<ApiAnswer> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const cookie = await visitorCookie(signal);
    const res = await fetch(url, {
      method: form === undefined ? 'GET' : 'POST',
      headers: {
        'User-Agent': userAgentForUrl(url),
        Accept: 'application/json, text/plain, */*',
        Referer: REFERER,
        Cookie: cookie,
        ...(form === undefined ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }),
      },
      ...(form === undefined ? {} : { body: form }),
      redirect: 'manual',
      signal: requestSignal(signal),
    });
    if (res.status < 300 || res.status >= 400) return { status: res.status, text: await res.text() };
    sendLog(`🧣 [Weibo] The visitor cookie was turned away (HTTP ${res.status}) — asking for a new one`);
    visitor = null;
  }
  throw new FlowUserError('flow.error.xPageUnreadable', { url }, 'Weibo kept sending the visitor to sign in');
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The post a video page belongs to; null when the video API has no such video. */
async function videoPostId(id: string, signal: AbortSignal | undefined): Promise<{ status: number; mid: string | null }> {
  const oid = weiboVideoObjectId(id);
  const url = `${ORIGIN}/tv/api/component?page=${encodeURIComponent(`/tv/show/${oid}`)}`;
  const form = `data=${encodeURIComponent(JSON.stringify({ Component_Play_Playinfo: { oid } }))}`;
  const { status, text } = await api(url, signal, form);
  return { status, mid: status === 200 ? weiboVideoMid(text) : null };
}

/** The video versions, made fetchable: Weibo's CDN refuses a browser that comes without a weibo.com `Referer`. */
function withFetchHeaders(post: XPost): void {
  for (const media of [...post.media, ...post.quoteMedia]) {
    for (const variant of media.variants) {
      variant.headers = { 'User-Agent': userAgentForUrl(variant.url), Referer: REFERER };
    }
  }
}

async function readComments(mid: string, link: string, signal: AbortSignal | undefined): Promise<XPost[]> {
  const out: XPost[] = [];
  let next: string | null = null;
  for (let pageIndex = 0; pageIndex < MAX_COMMENT_PAGES && out.length < MAX_COMMENTS; pageIndex++) {
    const more = next ? `&flow=0&max_id=${next}` : '';
    const url = `${ORIGIN}/ajax/statuses/buildComments?is_reload=1&id=${mid}&is_show_bulletin=2&is_mix=0&count=20&fetch_level=0${more}`;
    const { status, text } = await api(url, signal);
    if (status !== 200) break;
    const page = readWeiboComments(parseJson(text), link);
    out.push(...page.comments);
    if (page.next === null) break;
    next = page.next;
  }
  return out.slice(0, MAX_COMMENTS);
}

/**
 * The post and, when `comments`, up to 40 comments; `value` null when there is none (404 for one
 * Weibo says does not exist or was removed). `signal` (a flow's Stop) aborts the request in flight
 * and ends the read.
 */
export async function readWeiboThread(
  url: string,
  { comments, signal }: { comments: boolean; signal?: AbortSignal },
): Promise<XRead<XThread>> {
  const link = parseWeiboUrl(url);
  if (!link) return { status: 400, value: null };
  let id = link.id;
  if (link.kind === 'video') {
    const video = await videoPostId(link.id, signal);
    if (!video.mid) {
      sendLog(`🧣 [Weibo] No video ${link.id} (HTTP ${video.status})`);
      return { status: video.status === 200 ? 404 : video.status, value: null };
    }
    id = video.mid;
  }
  const show = await api(`${ORIGIN}/ajax/statuses/show?id=${id}&isGetLongText=true`, signal);
  const body = obj(parseJson(show.text));
  if (show.status !== 200 || !body) return { status: show.status, value: null };
  const refused = weiboPostError(body);
  if (refused) {
    sendLog(`🧣 [Weibo] Post ${id} not shown: ${refused.message || 'no reason given'}`);
    return { status: refused.missing ? 404 : 200, value: null };
  }
  const focal = weiboPost(body);
  withFetchHeaders(focal);
  const replies = comments
    ? await readComments(focal.id, focal.link, signal).catch((err: unknown) => {
      // A Stop is not an unreadable comment list: it ends the read.
      signal?.throwIfAborted();
      sendLog(`🧣 [Weibo] Comments unreadable: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    })
    : [];
  sendLog(`🧣 [Weibo] Read — ${focal.media.length} media, ${replies.length} comment(s)`);
  return { status: 200, value: { focal, replies } };
}
