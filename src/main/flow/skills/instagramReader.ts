import { sendLog } from '../../helpers';
import { fetchRawResponse } from '../../pageLoader';
import { getSiteAccountStatus, siteSession } from '../../siteAccounts';
import { userAgentForUrl } from '../../userAgent';
import { instagramMediaId, isInstagramHost, parseInstagramUrl, type InstagramRef } from '../../../shared/instagramLinks';
import { FlowUserError } from '../userError';
import {
  findPostIn, readComments, readInfoItem, readInstagramPage, readProfileId, readStoryReel, storyReelPost,
} from './instagramPosts';
import { readSignedInPage, readSignedInProfile } from '../../instagram/signedInPage';
import { readInstagramProfile, type ProfileIo } from './instagramProfile';
import { arr, obj, str } from './jsonPick';
import { notForOthersError, signedInOnlyError } from './readAccess';
import { NAVIGATION_HEADERS, stayOnHosts } from './siteFetch';
import type { XPost, XThread } from './xPosts';
import type { XRead } from './xReader';

/**
 * Reading an Instagram link. Signed out, a post's own page carries it and its first 15 comments;
 * signed in to Instagram in Settings (its own partition, `persist:instagram`), the web API reads
 * posts the page hides from visitors, more comments, and stories, which exist only signed in.
 * Anything that goes wrong signed in falls back to the public page.
 */

/** The headers and origin the site's own pages send with an API call; the API needs all of them. */
const API_ORIGIN = 'https://www.instagram.com';
const API_HEADERS = {
  Accept: '*/*',
  'X-IG-App-ID': '936619743392459',
  'X-Requested-With': 'XMLHttpRequest',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
} as const;

const API_BASE = 'https://www.instagram.com/api/v1/';

/** Comments read signed in: the analysis reads 40; three pages of 15 cover it. */
const MAX_COMMENT_PAGES = 3;
const MAX_COMMENTS = 40;

const stayOnInstagram = stayOnHosts('Instagram', isInstagramHost);

interface ApiAnswer {
  status: number;
  body: unknown;
}

/** One signed-in API call; `body` is null when the answer was not JSON (a sign-in page, an error page). */
async function api(path: string, signal: AbortSignal | undefined): Promise<ApiAnswer> {
  const url = `${API_BASE}${path}`;
  const { status, text } = await fetchRawResponse(url, {
    headers: { 'User-Agent': userAgentForUrl(url), ...API_HEADERS },
    validateRedirectHost: stayOnInstagram,
    cookiesFrom: siteSession('instagram'),
    origin: API_ORIGIN,
    signal,
  });
  try {
    return { status, body: JSON.parse(text) as unknown };
  } catch {
    return { status, body: null };
  }
}

async function page(url: string, signedIn: boolean, signal: AbortSignal | undefined): Promise<{ status: number; text: string }> {
  return fetchRawResponse(url, {
    headers: { 'User-Agent': userAgentForUrl(url), ...NAVIGATION_HEADERS },
    validateRedirectHost: stayOnInstagram,
    ...(signedIn ? { cookiesFrom: siteSession('instagram') } : {}),
    signal,
  });
}

async function readSignedInComments(
  mediaId: string,
  postLink: string,
  signal: AbortSignal | undefined,
  pages = MAX_COMMENT_PAGES,
): Promise<XPost[]> {
  const out: XPost[] = [];
  let cursor = '';
  for (let pageIndex = 0; pageIndex < pages && out.length < MAX_COMMENTS; pageIndex++) {
    const query = `can_support_threading=true&permalink_enabled=false${cursor ? `&min_id=${encodeURIComponent(cursor)}` : ''}`;
    const { body } = await api(`media/${mediaId}/comments/?${query}`, signal);
    const answer = obj(body);
    if (!answer) break;
    out.push(...readComments(arr(answer.comments), postLink));
    cursor = str(answer.next_min_id);
    if (!cursor) break;
  }
  return out.slice(0, MAX_COMMENTS);
}

/**
 * A post read signed in: its page opened in a hidden window and the post taken from what the page
 * held or received (`signedInPage.ts`). The comments are the API's, asked only when wanted: a forward shows none, and someone else is refused a post shown to some
 * people only (`forOthers`), so its comments are never asked for them.
 */
async function readSignedInPost(
  ref: InstagramRef,
  signal: AbortSignal | undefined,
  comments: boolean,
  forOthers: boolean,
): Promise<XRead<XThread>> {
  const mediaId = instagramMediaId(ref.id);
  const opened = await readSignedInPage(ref.url, (answers) => findPostIn(answers, ref.id) !== null, signal);
  const focal = findPostIn(opened.answers, ref.id);
  if (!focal) {
    const named = opened.html.split(ref.id).length - 1;
    sendLog(`📷 [Instagram] The post page held no post (its HTML names the code ${named}×, ${opened.answers.length} JSON block(s)) — it asked ${opened.operations.join(', ') || 'nothing'}`);
    return { status: opened.status, value: null };
  }
  if (!comments || (forOthers && focal.audience === 'restricted')) return { status: opened.status, value: { focal, replies: [] } };
  const replies = await readSignedInComments(mediaId, focal.link, signal).catch((err: unknown) => {
    // A Stop is not an unreadable page: it ends the read instead of returning the post without comments.
    signal?.throwIfAborted();
    sendLog(`📷 [Instagram] Comments unreadable signed in: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  });
  return { status: opened.status, value: { focal, replies } };
}

async function readPublicPost(ref: InstagramRef, signal: AbortSignal | undefined): Promise<XRead<XThread>> {
  const { status, text } = await page(ref.url, false, signal);
  return { status, value: status < 400 ? readInstagramPage(text) : null };
}

/**
 * What only a sign-in shows. Allowed one: sign in in Settings. Not allowed (someone else's bot
 * message): a post is said to show only signed in (the sign-in may still read it for them,
 * `readLinkedThread`), stories and a profile are not read for them at all — never how to sign in.
 */
function signInRequired(url: string, what: 'post' | 'profile' | 'stories', allowed: boolean): FlowUserError {
  if (!allowed) return what === 'post' ? signedInOnlyError('instagram', url) : notForOthersError('instagram', url);
  return new FlowUserError(
    'flow.error.instagramSignIn',
    { url },
    `Instagram ${what} needs an Instagram sign-in (Settings › Connectors › Instagram): ${url}`,
  );
}

interface PostRead {
  /** Instagram is signed in and the sign-in may be used. */
  signedIn: boolean;
  /** The sign-in may be used (`SiteReadOptions.signedIn`). */
  allowed: boolean;
  comments: boolean;
  /** The sign-in reads it for someone else (`SiteReadOptions.forOthers`). */
  forOthers: boolean;
  signal: AbortSignal | undefined;
}

async function readPost(ref: InstagramRef, { signedIn, allowed, comments, forOthers, signal }: PostRead): Promise<XRead<XThread>> {
  if (signedIn) {
    try {
      const read = await readSignedInPost(ref, signal, comments, forOthers);
      if (read.value) {
        sendLog(`📷 [Instagram] Read signed in — ${ref.id} (${read.value.replies.length} comment(s))`);
        return read;
      }
      sendLog(`📷 [Instagram] The signed-in page held no post (HTTP ${read.status}) — reading the public page instead`);
    } catch (err) {
      signal?.throwIfAborted();
      sendLog(`📷 [Instagram] Signed-in read failed: ${err instanceof Error ? err.message : String(err)} — reading the public page instead`);
    }
  }
  const read = await readPublicPost(ref, signal);
  // A page with no post for a visitor: a private account, an age gate, or the sign-in wall.
  if (!read.value && read.status < 400 && !signedIn) throw signInRequired(ref.url, 'post', allowed);
  return read;
}

function storyGone(url: string): FlowUserError {
  return new FlowUserError('flow.error.instagramStoryGone', { url }, `Instagram story expired, deleted or private: ${url}`);
}

/** One story by its id alone: only when its account's stories cannot be read (see `readStories`). */
async function readStoryItem(ref: InstagramRef, signal: AbortSignal | undefined): Promise<XThread> {
  const { status, body } = await api(`media/${ref.id}/info/`, signal);
  const focal = readInfoItem(body);
  if (!focal) {
    sendLog(`📷 [Instagram] media/${ref.id}/info/ held no story (HTTP ${status}${str(obj(body)?.message) ? `: ${str(obj(body)?.message)}` : ''})`);
    throw storyGone(ref.url);
  }
  return { focal, replies: [] };
}

async function readReel(ref: InstagramRef, key: string, signal: AbortSignal | undefined): Promise<XThread> {
  const { body } = await api(`feed/reels_media/?reel_ids=${encodeURIComponent(key)}`, signal);
  const reel = readStoryReel(body, key);
  if (!reel) throw storyGone(ref.url);
  if (reel.items.length === 0) {
    throw new FlowUserError('flow.error.instagramNoStories', { account: `@${reel.author}` }, `@${reel.author} has no stories up now`);
  }
  const focal = storyReelPost(reel, ref);
  if (!focal) throw storyGone(ref.url);
  return { focal, replies: [] };
}

async function readAccountStories(ref: InstagramRef, signal: AbortSignal | undefined): Promise<XThread> {
  const profile = `https://www.instagram.com/${ref.author}/`;
  const { status, text } = await page(profile, true, signal);
  const id = status < 400 ? readProfileId(text) : '';
  if (!id) {
    throw new FlowUserError('flow.error.instagramNoAccount', { account: `@${ref.author}` }, `Instagram account not found: @${ref.author} (HTTP ${status})`);
  }
  return readReel(ref, id, signal);
}

/** A random 1.5–3 s between a profile's requests, as a person browsing would leave; Stop ends it. */
const PROFILE_PAUSE_MS = [1_500, 3_000] as const;

function pause(signal: AbortSignal | undefined): Promise<void> {
  const ms = PROFILE_PAUSE_MS[0] + Math.random() * (PROFILE_PAUSE_MS[1] - PROFILE_PAUSE_MS[0]);
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', stop);
      resolve();
    }, ms);
    const stop = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', stop, { once: true });
  });
}

function profileIo(signal: AbortSignal | undefined): ProfileIo {
  return {
    profile: (author) => readSignedInProfile(author, signal),
    api: (path) => api(path, signal),
    comments: (mediaId, postLink) => readSignedInComments(mediaId, postLink, signal, 1),
    pause: () => pause(signal),
  };
}

/** The account's stories were read and the story is not among them: a read by its id finds no more. */
function isAnswered(err: unknown): boolean {
  return err instanceof FlowUserError && (err.key === 'flow.error.instagramStoryGone' || err.key === 'flow.error.instagramNoStories');
}

/**
 * A story link reads the account's stories whole, as Facebook's do, so the chat can offer every
 * one of them (`storyReelPost`); a button's `one` link reads the same set and takes its story.
 */
async function readStories(ref: InstagramRef, signal: AbortSignal | undefined): Promise<XThread> {
  if (ref.kind === 'highlight') return readReel(ref, `highlight:${ref.id}`, signal);
  if (ref.kind === 'stories') return readAccountStories(ref, signal);
  try {
    return await readAccountStories(ref, signal);
  } catch (err) {
    // The account's set unreadable (its profile page changed, say): try the story by its id.
    signal?.throwIfAborted();
    if (isAnswered(err)) throw err;
    sendLog(`📷 [Instagram] The account's stories unreadable (${err instanceof Error ? err.message : String(err)}) — reading the linked story alone`);
    return readStoryItem(ref, signal);
  }
}

/**
 * The post (or story) and the comments read; `value` is null when the page held no post.
 * `signal` (a flow's Stop) aborts the request in flight and ends the read. `allowed` false: the
 * sign-in is not used even when Instagram is signed in (`SiteReadOptions.signedIn`), nor even
 * asked about. `forOthers`: the sign-in reads it for someone else (`SiteReadOptions.forOthers`).
 */
export async function readInstagramThread(
  url: string,
  signal?: AbortSignal,
  comments = true,
  allowed = true,
  forOthers = false,
): Promise<XRead<XThread>> {
  const ref = parseInstagramUrl(url);
  if (!ref) return { status: 400, value: null };
  const signedIn = allowed && await getSiteAccountStatus('instagram').catch(() => false);
  if (ref.kind === 'post') return readPost(ref, { signedIn, allowed, comments, forOthers, signal });
  if (ref.kind === 'profile') {
    if (!signedIn) throw signInRequired(ref.url, 'profile', allowed);
    return { status: 200, value: await readInstagramProfile(ref, profileIo(signal), comments) };
  }
  if (!signedIn) throw signInRequired(ref.url, 'stories', allowed);
  const thread = await readStories(ref, signal);
  sendLog(`📷 [Instagram] Read ${ref.kind} — ${thread.focal.media.length} item(s)`);
  return { status: 200, value: thread };
}
