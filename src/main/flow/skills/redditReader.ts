import { session } from 'electron';
import type { WebContents } from 'electron';
import { sendLog } from '../../helpers';
import { fetchRawResponse } from '../../pageLoader';
import { sitePagePartition, withSitePage } from '../../sitePage';
import { offerSiteVerification, requestSiteVerification } from '../../siteVerification';
import { userAgentForUrl } from '../../userAgent';
import { readDashManifest } from '../../downloader/streamRead';
import { hostAllowlist } from '../../downloader/streamFetch';
import { siteLabel } from '../../../shared/linkSites/rows';
import {
  isRedditHost, parseRedditUrl, parseResolvedRedditUrl, redditPostUrl, type RedditLink,
} from '../../../shared/linkSites/redditLinks';
import { FlowUserError } from '../userError';
import { NAVIGATION_HEADERS, resolveShortLink, stayOnHosts } from './siteFetch';
import {
  checkPageReason, dashVariants, readRedditPage, redditPageKind, redditPost, redditReplies, type RedditPage,
} from './redditPosts';
import type { XMedia, XThread } from './xPosts';
import type { XRead } from './xReader';

/*
 * Reads a Reddit post signed out, from the post's own page. A hidden window on the reader's
 * persistent partition gets past the site check first; a check it cannot pass goes to the shared
 * verification window (`siteVerification.ts`). Posts marked 18+ or quarantined are refused.
 */

const stayOnReddit = stayOnHosts('Reddit', isRedditHost);
/** The hidden window's wait for Reddit's own page: a check it passes takes a few seconds. */
const PASS_WAIT_MS = 25_000;
/** Reddit's app shell: on every page of its own, never on a check or block page. */
const PASSED_PROBE = `document.querySelector('shreddit-app') ? true : null`;
const VIDEO_HOSTS = hostAllowlist(['v.redd.it']);

/** The verification window's page is Reddit's own again: loaded, on reddit.com, its app shell up. */
export const CLEARED_PROBE = `(() => /(^|\\.)reddit\\.com$/.test(location.hostname) && document.readyState !== 'loading'
  && !!document.querySelector('shreddit-app'))()`;

async function isCleared(contents: WebContents): Promise<boolean> {
  return (await contents.executeJavaScript(CLEARED_PROBE, true)) === true;
}

function readerSession(): Electron.Session {
  return session.fromPartition(sitePagePartition('reddit'));
}

function getPage(url: string, signal: AbortSignal | undefined): Promise<{ status: number; text: string }> {
  return fetchRawResponse(url, {
    headers: { 'User-Agent': userAgentForUrl(url), ...NAVIGATION_HEADERS },
    validateRedirectHost: stayOnReddit,
    cookiesFrom: readerSession(),
    signal,
  });
}

/** Opens the page in the reader's hidden window until Reddit's own page shows; any failure is only logged. */
async function passCheck(url: string, signal: AbortSignal | undefined): Promise<void> {
  const started = Date.now();
  try {
    await withSitePage('reddit', url, signal, (page) => page.waitFor(PASSED_PROBE, PASS_WAIT_MS));
    sendLog(`👽 [Reddit] The hidden window passed the check (${Date.now() - started} ms)`);
  } catch (err) {
    // A Stop is not a failed check: it ends the read.
    signal?.throwIfAborted();
    sendLog(`👽 [Reddit] The hidden window did not pass the check: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * The post's page, through the check when there is one. A check the hidden window cannot pass
 * wants a person: one at the computer answers it in the verification window and the page is read
 * again; otherwise the read fails with `SiteVerificationRequired` and a notification offers the
 * window. Still a check after the person passed it: Reddit is holding back, `siteThrottled`.
 */
async function readPage(url: string, signal: AbortSignal | undefined, interactive: boolean): Promise<{ status: number; text: string }> {
  const first = await getPage(url, signal);
  if (redditPageKind(first.text) !== 'check') return first;
  sendLog(`👽 [Reddit] ${checkPageReason(first.text)} (HTTP ${first.status}) — opening the page in a hidden window`);
  await passCheck(url, signal);
  const second = await getPage(url, signal);
  if (redditPageKind(second.text) !== 'check') return second;
  sendLog(`👽 [Reddit] Still ${checkPageReason(second.text)} after the hidden window — ${interactive ? 'asking the person' : 'offering the verification window'}`);
  const request = { site: 'reddit', partition: sitePagePartition('reddit'), url, isCleared };
  if (!interactive) throw offerSiteVerification(request);
  await requestSiteVerification({ ...request, signal });
  const third = await getPage(url, signal);
  if (redditPageKind(third.text) !== 'check') return third;
  const site = siteLabel('reddit');
  throw new FlowUserError('flow.error.siteThrottled', { site }, `${site} still sent its check (${checkPageReason(third.text)}) after the verification passed: ${url}`);
}

/** Where a share link or v.redd.it video leads, as a post: its own errors when it expired or leads elsewhere. */
async function resolveShare(link: RedditLink, signal: AbortSignal | undefined): Promise<RedditLink> {
  const site = siteLabel('reddit');
  let location: string | null;
  try {
    location = await resolveShortLink(link.url, signal);
  } catch (err) {
    signal?.throwIfAborted();
    throw new FlowUserError('flow.error.xPageUnreadable', { url: link.url }, `Reddit share link did not resolve: ${err instanceof Error ? err.message : String(err)}`);
  }
  const resolved = location ? new URL(location, link.url) : null;
  const target = resolved ? parseResolvedRedditUrl(resolved.toString()) : null;
  if (target) return target;
  // A code Reddit does not know leads to its community.
  if (!resolved || /^\/(?:r\/[^/]+\/?)?$/.test(resolved.pathname)) {
    throw new FlowUserError('flow.error.shortLinkExpired', { site }, `Reddit share link expired or unknown: ${link.url}`);
  }
  throw new FlowUserError('flow.error.xPostUrl', { url: resolved.toString() }, `Reddit share link led to a page that is not a post: ${resolved.toString()}`);
}

/**
 * The post's media: its pictures, its ready mp4s, or — with none on the page — v.redd.it's DASH
 * renditions to put together. A video that cannot be read leaves the post without it (its text
 * is still forwarded); a Stop ends the read.
 */
async function mediaOf(page: RedditPage, signal: AbortSignal | undefined): Promise<XMedia[]> {
  const { media } = page;
  if (media.kind === 'images') return media.items;
  if (media.kind !== 'video') return [];
  if (media.variants.length > 0) {
    const [top] = media.variants;
    return [{ kind: 'video', image: media.poster, width: top.width, height: top.height, durationMs: media.durationMs, variants: media.variants }];
  }
  try {
    const manifest = await readDashManifest(`https://v.redd.it/${media.videoId}/DASHPlaylist.mpd`, { isAllowedHost: VIDEO_HOSTS, ...(signal ? { signal } : {}) });
    const variants = dashVariants(manifest, siteLabel('reddit'));
    if (variants.length === 0) {
      sendLog(`👽 [Reddit] Video ${media.videoId} has no H.264 rendition`);
      return [];
    }
    const [top] = variants;
    // A video without a sound track is forwarded the same; it just offers no MP3.
    const kind = variants.some((v) => v.stream?.audio) ? 'video' : 'gif';
    return [{ kind, image: media.poster, width: top.width, height: top.height, durationMs: Math.round(manifest.durationS * 1_000), variants }];
  } catch (err) {
    signal?.throwIfAborted();
    sendLog(`👽 [Reddit] Video ${media.videoId} unreadable: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * The post and, when `comments`, the first comments its page carries (25 at most); `value` null
 * when the page held no post (404 for one Reddit does not know). `signal` (a flow's Stop) aborts
 * the request in flight and closes the hidden window; `interactive`: the person started the read at
 * the computer, so a check that wants them opens the verification window.
 */
export async function readRedditThread(
  url: string,
  { comments, signal, interactive = false }: { comments: boolean; signal?: AbortSignal; interactive?: boolean },
): Promise<XRead<XThread>> {
  const parsed = parseRedditUrl(url);
  if (!parsed) return { status: 400, value: null };
  const link = parsed.kind === 'short' ? await resolveShare(parsed, signal) : parsed;
  const pageUrl = redditPostUrl(link.id);
  const { status, text } = await readPage(pageUrl, signal, interactive);
  const kind = redditPageKind(text);
  if (kind === 'gated') {
    throw new FlowUserError('flow.error.redditSignIn', {}, `Reddit shows this post to signed-in accounts only (18+ or quarantined): ${pageUrl}`);
  }
  const page = kind === 'post' ? readRedditPage(text) : null;
  if (!page) {
    sendLog(`👽 [Reddit] No post on the page (HTTP ${status}): ${pageUrl}`);
    return { status: status >= 400 ? status : 200, value: null };
  }
  const media = await mediaOf(page, signal);
  const focal = redditPost(page, media);
  const replies = comments ? redditReplies(page) : [];
  sendLog(`👽 [Reddit] Read ${page.community} ${page.id} (${page.postType}) — ${media.length} media, ${replies.length} comment(s)`);
  return { status: 200, value: { focal, replies } };
}
