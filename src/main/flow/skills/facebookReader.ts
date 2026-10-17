import { sendLog } from '../../helpers';
import { fetchRawResponse } from '../../pageLoader';
import { getSiteAccountStatus, siteSession } from '../../siteAccounts';
import { userAgentForUrl } from '../../userAgent';
import {
  facebookStoryLink, facebookVideoLink, isFacebookHost, parseFacebookUrl, type FacebookRef, type FacebookStoryRef,
} from '../../../shared/facebookLinks';
import { FlowUserError } from '../userError';
import {
  ALL_COMMENTS, COMMENTS_QUERY, commentsRequestBody, isQueryError, readBundleUrls, readCommentPage, readCommentsQueryId, readPageTokens,
} from './facebookComments';
import { postPhotoIds, readFacebookPage, readPhotoPage, readPostPage, readVideoPage, type FacebookRead } from './facebookPosts';
import { readStoryBucket, storyBucketPost } from './facebookStories';
import type { Json } from './jsonPick';
import { notForOthersError, signedInOnlyError } from './readAccess';
import { NAVIGATION_HEADERS, stayOnHosts } from './siteFetch';
import type { XPost, XThread } from './xPosts';
import type { XRead } from './xReader';

/**
 * Reading a Facebook link, without yt-dlp. Signed out, a
 * public reel, video or post page carries the post and its H.264 mp4s; signed in to Facebook in
 * Settings (its own partition, `persist:facebook`), the same pages also show what only friends or
 * a group's members may see, and each photo's own page its full size. Comments come from the
 * site's comments query either way. Anything that goes wrong signed in falls back to the public page.
 */

const ORIGIN = 'https://www.facebook.com';
const GRAPHQL_URL = `${ORIGIN}/api/graphql/`;

/** The analysis reads 40; about ten come a page. */
const MAX_COMMENTS = 40;
const MAX_COMMENT_PAGES = 6;
/** A photo post's photos each read at full size, signed in; a larger album keeps the page's copies past these. */
const MAX_PHOTO_PAGES = 10;
/** The bundles a page preloads, searched in order for the comments query. */
const MAX_BUNDLES = 40;

/** How long a search that found no comments query is not repeated: each one downloads dozens of bundles. */
const QUERY_MISS_RETRY_MS = 10 * 60_000;

/** The comments query's id, found once a run of the app: it changes only when Facebook ships new code. */
let commentsQueryId = '';
let queryMissUntil = 0;

/** Forgets the comments query's id and any recent miss, as a fresh start of the app does. */
export function resetFacebookCommentsQuery(): void {
  commentsQueryId = '';
  queryMissUntil = 0;
}

const stayOnFacebook = stayOnHosts('Facebook', isFacebookHost);

async function page(url: string, signedIn: boolean, signal: AbortSignal | undefined): Promise<{ status: number; text: string; finalUrl: string }> {
  return fetchRawResponse(url, {
    headers: { 'User-Agent': userAgentForUrl(url), ...NAVIGATION_HEADERS },
    validateRedirectHost: stayOnFacebook,
    ...(signedIn ? { cookiesFrom: siteSession('facebook') } : {}),
    signal,
  });
}

async function queryIdInBundles(html: string, signal: AbortSignal | undefined): Promise<string> {
  for (const url of readBundleUrls(html).slice(0, MAX_BUNDLES)) {
    try {
      const { status, text } = await fetchRawResponse(url, { headers: { 'User-Agent': userAgentForUrl(url) }, signal });
      const id = status < 400 ? readCommentsQueryId(text) : '';
      if (id) return id;
    } catch {
      // One bundle that cannot be read leaves the others to search; a Stop ends the search.
      signal?.throwIfAborted();
    }
  }
  return '';
}

/**
 * The comments query's id from the bundles this page loads, else from `fallbackUrl`'s: a reel page
 * loads its comments panel only when it opens, so none of its bundles defines the query, while the
 * same video's `/watch` page preloads it. The bundle list is public: the
 * fallback page is read signed out. A Stop throws before anything is remembered: it is not a miss.
 */
async function findCommentsQueryId(html: string, fallbackUrl: string, signal: AbortSignal | undefined): Promise<string> {
  if (commentsQueryId || Date.now() < queryMissUntil) return commentsQueryId;
  let id = await queryIdInBundles(html, signal);
  if (!id && fallbackUrl) {
    const fallback = await page(fallbackUrl, false, signal).catch(() => {
      signal?.throwIfAborted();
      return null;
    });
    if (fallback && fallback.status < 400) id = await queryIdInBundles(fallback.text, signal);
  }
  commentsQueryId = id;
  if (!id) queryMissUntil = Date.now() + QUERY_MISS_RETRY_MS;
  return id;
}

async function signedInUser(): Promise<string> {
  const cookies = await siteSession('facebook').cookies.get({ url: `${ORIGIN}/`, name: 'c_user' });
  return cookies[0]?.value ?? '0';
}

interface CommentsSource {
  /** The post page's HTML: its tokens and its bundles. */
  html: string;
  feedbackId: string;
  postLink: string;
  /** A page that loads the comments query when this one does not; "" for none. */
  fallbackUrl: string;
}

/** Up to 40 comments, newest threads included, through the site's own comments query. */
async function readComments(source: CommentsSource, signedIn: boolean, signal: AbortSignal | undefined): Promise<XPost[]> {
  const { html, feedbackId, postLink } = source;
  const tokens = readPageTokens(html);
  if (!feedbackId || !tokens.lsd) return [];
  const queryId = await findCommentsQueryId(html, source.fallbackUrl, signal);
  if (!queryId) {
    sendLog('📘 [Facebook] The comments query was not in the page\'s bundles — reading the post without comments');
    return [];
  }
  const user = signedIn ? await signedInUser() : '0';
  const out: XPost[] = [];
  let cursor = '';
  let order = ALL_COMMENTS;
  for (let pageIndex = 0; pageIndex < MAX_COMMENT_PAGES && out.length < MAX_COMMENTS; pageIndex++) {
    let text: string;
    try {
      ({ text } = await fetchRawResponse(GRAPHQL_URL, {
        headers: {
          'User-Agent': userAgentForUrl(GRAPHQL_URL),
          Accept: '*/*',
          'X-FB-LSD': tokens.lsd,
          'X-FB-Friendly-Name': COMMENTS_QUERY,
          'Sec-Fetch-Site': 'same-origin',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Dest': 'empty',
        },
        origin: ORIGIN,
        validateRedirectHost: stayOnFacebook,
        post: { contentType: 'application/x-www-form-urlencoded', body: commentsRequestBody({ queryId, feedbackId, cursor, tokens, user, order }) },
        ...(signedIn ? { cookiesFrom: siteSession('facebook') } : {}),
        signal,
      }));
    } catch (err) {
      // A page that times out ends the reading; the comments already read stay. A Stop ends the whole read.
      signal?.throwIfAborted();
      sendLog(`📘 [Facebook] Comments page ${pageIndex + 1} unreadable: ${err instanceof Error ? err.message : String(err)}`);
      break;
    }
    const answer = readCommentPage(text, postLink);
    if (!answer) {
      // Only the API refusing the query means Facebook replaced its id: found again next time.
      if (isQueryError(text)) commentsQueryId = '';
      break;
    }
    if (pageIndex === 0 && order && answer.comments.length === 0 && !answer.cursor) {
      // "All comments" came back empty: the site's default order may still list them.
      order = '';
      continue;
    }
    out.push(...answer.comments);
    cursor = answer.cursor;
    if (!cursor) break;
  }
  return out.slice(0, MAX_COMMENTS);
}

/** Each photo's own page, signed in: the only place Facebook names its full size. */
async function readPhotoPages(ids: readonly string[], signal: AbortSignal | undefined): Promise<Map<string, Json[]>> {
  const out = new Map<string, Json[]>();
  for (const id of ids.slice(0, MAX_PHOTO_PAGES)) {
    try {
      const { status, text } = await page(`${ORIGIN}/photo/?fbid=${id}`, true, signal);
      if (status < 400) out.set(id, readPhotoPage(text, id));
    } catch (err) {
      signal?.throwIfAborted();
      sendLog(`📘 [Facebook] Photo ${id} unreadable at full size: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}

/** Facebook's sign-in and security-check pages, where it sends whoever may not see a post. */
function isSignInWall(finalUrl: string, html: string): boolean {
  try {
    if (/^\/(?:login|checkpoint)(?:[/.]|$)|^\/login\.php/.test(new URL(finalUrl).pathname)) return true;
  } catch {
    // Not a URL: judged by the page alone.
  }
  return html.includes('id="login_form"');
}

function unsupportedLanding(finalUrl: string): FlowUserError {
  return new FlowUserError('flow.error.xPostUrl', { url: finalUrl }, `Facebook share link led to a page that is not a post, reel or video: ${finalUrl}`);
}

interface PageRead extends XRead<XThread> {
  /** Facebook answered with its sign-in wall instead of the post. */
  wall: boolean;
}

interface ReadOptions {
  /** False for a forward, which shows the post without its comments. */
  comments: boolean;
  /** A flow's Stop: aborts the request in flight and ends the read, never falling back. */
  signal?: AbortSignal;
  /**
   * False: the sign-in is not used even when Facebook is signed in, nor asked about
   * (`SiteReadOptions.signedIn`); what only it shows fails as such. Absent: used when signed in.
   */
  signedIn?: boolean;
  /**
   * Read with the sign-in for someone else (`SiteReadOptions.forOthers`): no photo pages and no
   * comments for a post marked as shown to some people only, which they are refused.
   */
  forOthers?: boolean;
}

async function readWith(ref: FacebookRef, signedIn: boolean, options: ReadOptions): Promise<PageRead> {
  const { signal } = options;
  const { status, text, finalUrl } = await page(ref.url, signedIn, signal);
  const empty = (): PageRead => ({ status, value: null, wall: status < 400 && isSignInWall(finalUrl, text) });
  if (status >= 400) return empty();
  // A share link names its post only once Facebook has redirected it.
  const target = ref.kind === 'share' ? parseFacebookUrl(finalUrl) : ref;
  if (!target || target.kind === 'share' || target.kind === 'story') {
    if (isSignInWall(finalUrl, text)) return empty();
    throw unsupportedLanding(finalUrl);
  }
  const facebookPage = readFacebookPage(text);
  // Someone else's read of a post shown to some people only goes no further than its page.
  const readsMore = (post: XPost): boolean => !options.forOthers || post.audience !== 'restricted';
  let read: FacebookRead | null;
  if (target.kind === 'post') {
    read = readPostPage(facebookPage, target);
    if (read && signedIn && readsMore(read.thread.focal)) {
      read = readPostPage(facebookPage, target, await readPhotoPages(postPhotoIds(facebookPage, target), signal));
    }
  } else {
    read = readVideoPage(facebookPage, target);
  }
  if (!read) return empty();
  const { focal } = read.thread;
  const source: CommentsSource = {
    html: text,
    feedbackId: read.feedbackId,
    postLink: focal.link,
    fallbackUrl: target.kind === 'reel' ? facebookVideoLink(target.id) : '',
  };
  const replies = options.comments && readsMore(focal)
    ? await readComments(source, signedIn, signal).catch((err: unknown) => {
      signal?.throwIfAborted();
      sendLog(`📘 [Facebook] Comments unreadable: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    })
    : [];
  return { status, value: { focal: { ...focal, replyCount: Math.max(focal.replyCount, replies.length) }, replies }, wall: false };
}

/**
 * Not allowed to use the sign-in (someone else's bot message): said to show only signed in (the
 * sign-in may still read it for them, `readLinkedThread`), never "sign in".
 */
function signInRequired(url: string, allowed: boolean): FlowUserError {
  if (!allowed) return signedInOnlyError('facebook', url);
  return new FlowUserError(
    'flow.error.facebookSignIn',
    { url },
    `This Facebook post needs a Facebook sign-in (Settings › Connectors › Facebook): ${url}`,
  );
}

/**
 * A person's stories, which Facebook shows only signed in: the story viewer's page holds them all
 * (`facebookStories.ts`). No public page to fall back to, and no comments. Never for anyone but
 * an admin's own runs: viewing them marks the owner's account as having seen them.
 */
async function readStories(
  ref: FacebookRef,
  story: FacebookStoryRef,
  signal: AbortSignal | undefined,
  allowed: boolean,
): Promise<XRead<XThread>> {
  if (!allowed) throw notForOthersError('facebook', ref.url);
  const signInFirst = (): FlowUserError => new FlowUserError(
    'flow.error.facebookStoriesSignIn',
    { url: ref.url },
    `Facebook stories need a Facebook sign-in (Settings › Connectors › Facebook): ${ref.url}`,
  );
  const signedIn = await getSiteAccountStatus('facebook').catch(() => false);
  if (!signedIn) throw signInFirst();
  const { status, text, finalUrl } = await page(facebookStoryLink(story.bucket, story.card), true, signal);
  if (status >= 400) return { status, value: null };
  // A sign-in Facebook has since ended still has its cookie: the wall it gets says so.
  if (isSignInWall(finalUrl, text)) throw signInFirst();
  const bucket = readStoryBucket(readFacebookPage(text), story);
  if (!bucket || bucket.items.length === 0) {
    throw new FlowUserError('flow.error.facebookNoStories', { url: ref.url }, `No Facebook stories up now at ${ref.url}`);
  }
  const focal = storyBucketPost(bucket, story);
  if (!focal) {
    throw new FlowUserError('flow.error.facebookStoryGone', { url: ref.url }, `Facebook story expired or deleted: ${ref.url}`);
  }
  sendLog(`📘 [Facebook] Read ${bucket.items.length} stor${bucket.items.length === 1 ? 'y' : 'ies'} signed in${story.pick ? ` (${story.pick})` : ''}`);
  return { status, value: { focal, replies: [] } };
}

/**
 * The post (reel, video) and the comments read; `value` is null when the page held no post.
 * A forward passes `comments: false`: comments cost a dozen requests and it shows none.
 */
export async function readFacebookThread(url: string, options: ReadOptions = { comments: true }): Promise<XRead<XThread>> {
  const ref = parseFacebookUrl(url);
  if (!ref) return { status: 400, value: null };
  const allowed = options.signedIn !== false;
  if (ref.story) return readStories(ref, ref.story, options.signal, allowed);
  const signedIn = allowed && await getSiteAccountStatus('facebook').catch(() => false);
  // A sign-in Facebook has since ended still has its cookie: the wall it gets says so.
  let signInEnded = false;
  if (signedIn) {
    try {
      const read = await readWith(ref, true, options);
      if (read.value) {
        sendLog(`📘 [Facebook] Read signed in — ${read.value.focal.media.length} media, ${read.value.replies.length} comment(s)`);
        return read;
      }
      signInEnded = read.wall;
      sendLog(`📘 [Facebook] The signed-in page held no post (HTTP ${read.status}${read.wall ? ', sign-in wall' : ''}) — reading the public page instead`);
    } catch (err) {
      if (err instanceof FlowUserError || options.signal?.aborted) throw err;
      sendLog(`📘 [Facebook] Signed-in read failed: ${err instanceof Error ? err.message : String(err)} — reading the public page instead`);
    }
  }
  const read = await readWith(ref, false, options);
  // A page with no post for a visitor: friends only, a group's members, or the sign-in wall.
  if (!read.value && read.status < 400 && (!signedIn || signInEnded)) throw signInRequired(ref.url, allowed);
  if (read.value) sendLog(`📘 [Facebook] Read — ${read.value.focal.media.length} media, ${read.value.replies.length} comment(s)`);
  return { status: read.status, value: read.value };
}
