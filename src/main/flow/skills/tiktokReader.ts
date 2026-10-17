import { session } from 'electron';
import { sendLog } from '../../helpers';
import { fetchRawResponse } from '../../pageLoader';
import { userAgentForUrl } from '../../userAgent';
import { siteLabel } from '../../../shared/linkSites/rows';
import {
  isTikTokHost, parseResolvedTikTokUrl, parseTikTokUrl, tiktokPageUrl, type TikTokLink,
} from '../../../shared/linkSites/tiktokLinks';
import { FlowUserError } from '../userError';
import { NAVIGATION_HEADERS, resolveShortLink, stayOnHosts } from './siteFetch';
import { readTikTokComments, readTikTokPage, solveTikTokChallenge, tiktokPost, type TikTokPage } from './tiktokPosts';
import type { XPost, XThread } from './xPosts';
import type { XRead } from './xReader';

/*
 * Reads a TikTok link signed out, from the page itself rather than through yt-dlp, so the session
 * that read the page is the one that fetches the video. Its cookies live in an in-memory session
 * (`tiktok-reader`) and go with the download (`XVideoVariant.headers`); no sign-in partition is used.
 */

const PARTITION = 'tiktok-reader';
const ORIGIN = 'https://www.tiktok.com';
const COOKIE_URL = `${ORIGIN}/`;
/** The challenge cookie lives a second on the site; two minutes covers the second request. */
const CHALLENGE_COOKIE_S = 120;

/** Comments read for the analysis: two pages of 20. */
const MAX_COMMENT_PAGES = 2;
const MAX_COMMENTS = 40;

const stayOnTikTok = stayOnHosts('TikTok', isTikTokHost);

function readerSession(): Electron.Session {
  return session.fromPartition(PARTITION);
}

async function getPage(url: string, signal: AbortSignal | undefined): Promise<{ status: number; text: string }> {
  return fetchRawResponse(url, {
    headers: { 'User-Agent': userAgentForUrl(url), ...NAVIGATION_HEADERS },
    validateRedirectHost: stayOnTikTok,
    cookiesFrom: readerSession(),
    signal,
  });
}

/** The post page, through the challenge when there is one; `page` null when it carried no post data. */
async function readPage(url: string, signal: AbortSignal | undefined): Promise<{ status: number; page: TikTokPage | null }> {
  const first = await getPage(url, signal);
  const page = readTikTokPage(first.text);
  if (page) return { status: first.status, page };
  const answer = solveTikTokChallenge(first.text);
  if (!answer) return { status: first.status, page: null };
  const cookies = readerSession().cookies;
  const expirationDate = Math.floor(Date.now() / 1_000) + CHALLENGE_COOKIE_S;
  for (const { name, value } of answer) {
    await cookies.set({ url: COOKIE_URL, domain: '.tiktok.com', path: '/', name, value, secure: true, expirationDate });
  }
  try {
    const second = await getPage(url, signal);
    sendLog(`🎵 [TikTok] Answered the page's challenge (HTTP ${second.status})`);
    return { status: second.status, page: readTikTokPage(second.text) };
  } finally {
    // The page's own script lets them expire at once: they answer this one request only.
    for (const { name } of answer) await cookies.remove(COOKIE_URL, name).catch(() => {});
  }
}

/** The cookie header a video URL is fetched with: the reading session's own cookies for that host. */
async function cookieHeader(url: string): Promise<string> {
  const cookies = await readerSession().cookies.get({ url });
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/** The video versions, made fetchable: the session's cookies and a TikTok `Referer` (both needed). */
async function withFetchHeaders(post: XPost, url: string): Promise<void> {
  for (const media of post.media) {
    for (const variant of media.variants) {
      const cookie = await cookieHeader(variant.url);
      variant.headers = {
        'User-Agent': userAgentForUrl(url),
        Referer: COOKIE_URL,
        ...(cookie ? { Cookie: cookie } : {}),
      };
    }
  }
}

async function readComments(id: string, link: string, signal: AbortSignal | undefined): Promise<XPost[]> {
  const out: XPost[] = [];
  let cursor = 0;
  for (let pageIndex = 0; pageIndex < MAX_COMMENT_PAGES && out.length < MAX_COMMENTS; pageIndex++) {
    const url = `${ORIGIN}/api/comment/list/?aid=1988&aweme_id=${id}&count=20&cursor=${cursor}`;
    const { status, text } = await fetchRawResponse(url, {
      headers: { 'User-Agent': userAgentForUrl(url), Accept: 'application/json, text/plain, */*' },
      validateRedirectHost: stayOnTikTok,
      cookiesFrom: readerSession(),
      signal,
    });
    if (status >= 400) break;
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      break;
    }
    const page = readTikTokComments(body, link);
    out.push(...page.comments);
    if (page.next === null) break;
    cursor = page.next;
  }
  return out.slice(0, MAX_COMMENTS);
}

/** Where a share link leads, as a post: its own errors when it has expired or leads elsewhere. */
async function resolveShare(link: TikTokLink, signal: AbortSignal | undefined): Promise<TikTokLink> {
  const site = siteLabel('tiktok');
  let location: string | null;
  try {
    location = await resolveShortLink(link.url, signal);
  } catch (err) {
    signal?.throwIfAborted();
    throw new FlowUserError('flow.error.xPageUnreadable', { url: link.url }, `TikTok share link did not resolve: ${err instanceof Error ? err.message : String(err)}`);
  }
  const target = location ? parseResolvedTikTokUrl(new URL(location, link.url).toString()) : null;
  if (target) return target;
  // An unknown or expired code leads to the home page.
  const home = location !== null && /^\/?$/.test(new URL(location, link.url).pathname);
  if (location === null || home) {
    throw new FlowUserError('flow.error.shortLinkExpired', { site }, `TikTok share link expired or unknown: ${link.url}`);
  }
  throw new FlowUserError('flow.error.xPostUrl', { url: location }, `TikTok share link led to a page that is not a post: ${location}`);
}

/**
 * The post and, when `comments`, up to 40 comments; `value` null when the page held none (404 for
 * one TikTok says does not exist, or is private or removed). `signal` (a flow's Stop) aborts the
 * request in flight and ends the read.
 */
export async function readTikTokThread(
  url: string,
  { comments, signal }: { comments: boolean; signal?: AbortSignal },
): Promise<XRead<XThread>> {
  const parsed = parseTikTokUrl(url);
  if (!parsed) return { status: 400, value: null };
  const link = parsed.kind === 'short' ? await resolveShare(parsed, signal) : parsed;
  const pageUrl = tiktokPageUrl(link.id, link.author);
  const { status, page } = await readPage(pageUrl, signal);
  if (!page) return { status: status >= 400 ? status : 200, value: null };
  if (!page.item) {
    sendLog(`🎵 [TikTok] No post on the page (status ${page.statusCode}): ${pageUrl}`);
    return { status: 404, value: null };
  }
  const focal = tiktokPost(page.item);
  await withFetchHeaders(focal, pageUrl);
  const replies = comments
    ? await readComments(focal.id, focal.link, signal).catch((err: unknown) => {
      // A Stop is not an unreadable comment list: it ends the read.
      signal?.throwIfAborted();
      sendLog(`🎵 [TikTok] Comments unreadable: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    })
    : [];
  sendLog(`🎵 [TikTok] Read — ${focal.media.length} media, ${replies.length} comment(s)`);
  return { status: 200, value: { focal, replies } };
}
