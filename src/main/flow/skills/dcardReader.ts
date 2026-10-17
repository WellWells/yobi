import { session } from 'electron';
import type { WebContents } from 'electron';
import { sendLog } from '../../helpers';
import { fetchRawResponse } from '../../pageLoader';
import { SitePageTimeout, sitePagePartition, withSitePage } from '../../sitePage';
import { offerSiteVerification, requestSiteVerification } from '../../siteVerification';
import { userAgentForUrl } from '../../userAgent';
import { isDcardHost, parseDcardUrl, type DcardLink } from '../../../shared/linkSites/dcardLinks';
import { siteLabel } from '../../../shared/linkSites/rows';
import { FlowUserError } from '../userError';
import {
  dcardComments, dcardPostFromApi, dcardPostFromLd, dcardPostFromMeta, dcardPostFromNextData, type DcardComment, type DcardPageMeta,
} from './dcardPosts';
import { stayOnHosts } from './siteFetch';
import type { XPost, XThread } from './xPosts';
import type { XRead } from './xReader';

/*
 * Reads a Dcard link, signed out. The post is read in a hidden window (`sitePage.ts`) from the
 * page's own Next.js data, else the post API once, else the page's ld+json, else its og tags. A
 * challenge still up after `CHALLENGE_WAIT_MS` opens a one-time verification window when the read
 * started at the computer (`siteVerification.ts`); otherwise the read fails and a notification
 * offers the window. The analysis's comments are plain requests to the comments API.
 */

const ORIGIN = 'https://www.dcard.tw';
/** A managed challenge passes within seconds; one still up after this wants a click. */
export const CHALLENGE_WAIT_MS = 20_000;
/** After the API refused: how long the rendered page gets to show its ld+json. */
export const LD_WAIT_MS = 8_000;
/** The whole wait for the page, inside the hidden window's own 60 s. */
const PAGE_WAIT_MS = 45_000;

/** The analysis reads the 100 most-liked comments: one page. */
export const MAX_COMMENTS = 100;
/** And the replies under the most-liked few that have any, a page each. */
export const REPLY_PARENTS = 3;
export const REPLIES_PER_PARENT = 10;

const stayOnDcard = stayOnHosts('Dcard', isDcardHost);

/** What the page script hands back once the page settled. */
export interface DcardPageRead {
  /** `challenge`: still challenged past the wait; `done`: the page answered (whatever it held). */
  phase: 'challenge' | 'done';
  /** The API's status (0 when the request failed; 200 when the page's own data held the post), and its body when that was 200. */
  status?: number;
  api?: string;
  /** The page's `__NEXT_DATA__` text, when it holds the post: then the API was not asked. */
  next?: string;
  ld?: string[];
  meta?: DcardPageMeta;
}

/**
 * The script polled in the page (`SitePage.waitFor`): null while it is not on Dcard yet, still
 * loading or challenged, then what it holds. How long the challenge has been up is kept in
 * `sessionStorage`, which survives the challenge's reloads. Past the challenge it hands back the
 * page's own Next.js data; only a page without it asks the API, once, then waits for the ld+json.
 */
export function pageProbe(id: string): string {
  return `(() => {
    // The blank page the window opens on (for its Chrome identity) is not Dcard yet.
    if (!/(^|\\.)dcard\\.tw$/.test(location.hostname)) return null;
    const KEY = 'yobi-dcard-challenge';
    // Dcard's own page (its Next.js data or og tags) means past the challenge, whatever marks linger;
    // otherwise only the challenge page carries these marks.
    const dcardPage = Boolean(document.getElementById('__NEXT_DATA__') || document.querySelector('meta[property="og:title"]'));
    const challenged = !dcardPage && (Boolean(window._cf_chl_opt) || Boolean(document.querySelector('script[src*="/cdn-cgi/challenge-platform/"][src*="/orchestrate/"]')));
    if (challenged) {
      const since = Number(sessionStorage.getItem(KEY) || 0) || Date.now();
      sessionStorage.setItem(KEY, String(since));
      return Date.now() - since > ${CHALLENGE_WAIT_MS} ? JSON.stringify({ phase: 'challenge' }) : null;
    }
    if (document.readyState === 'loading') return null;
    const ld = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map((s) => s.textContent || '');
    const meta = (name) => Array.from(document.querySelectorAll('meta[property="' + name + '"]')).map((m) => m.getAttribute('content') || '');
    const answer = (status, api, next) => JSON.stringify({
      phase: 'done',
      status,
      api,
      next,
      ld,
      meta: { title: meta('og:title')[0] || document.title, description: meta('og:description')[0] || '', images: meta('og:image') },
    });
    // The post the server rendered into Dcard's own Next.js data: nothing to ask for.
    const nextData = (document.getElementById('__NEXT_DATA__') || {}).textContent || '';
    const rendered = (() => {
      try {
        return JSON.parse(nextData).props.dehydratedState.queries
          .some((q) => q && q.queryKey && q.queryKey[0] === 'post' && String(q.queryKey[1]) === '${id}' && q.state && q.state.data);
      } catch (e) {
        return false;
      }
    })();
    if (rendered) return answer(200, '', nextData);
    const state = window.__yobiDcard;
    if (state === undefined) {
      window.__yobiDcard = null;
      fetch('/service/api/v2/posts/${id}', { credentials: 'include', headers: { accept: 'application/json' } })
        .then((r) => r.text().then((body) => { window.__yobiDcard = { status: r.status, body, at: Date.now() }; }))
        .catch(() => { window.__yobiDcard = { status: 0, body: '', at: Date.now() }; });
      return null;
    }
    if (!state) return null;
    const hasPosting = ld.some((text) => text.includes('SocialMediaPosting'));
    if (state.status !== 200 && !hasPosting && Date.now() - state.at < ${LD_WAIT_MS}) return null;
    return answer(state.status, state.status === 200 ? state.body : '', '');
  })()`;
}

/**
 * Whether the page in the verification window is past the challenge: on Dcard, loaded, and Dcard's
 * own page there (challenge marks can linger on a passed page).
 */
export const CLEARED_PROBE = `(() => /(^|\\.)dcard\\.tw$/.test(location.hostname) && document.readyState !== 'loading'
  && Boolean(document.getElementById('__NEXT_DATA__') || document.querySelector('meta[property="og:title"]')))()`;

async function isCleared(contents: WebContents): Promise<boolean> {
  return (await contents.executeJavaScript(CLEARED_PROBE, true)) === true;
}

function throttled(link: DcardLink, why: string): FlowUserError {
  const site = siteLabel('dcard');
  return new FlowUserError('flow.error.siteThrottled', { site }, `${site} ${why}: ${link.url}`);
}

/** The page's read, through the hidden window: `challenge` when the check stayed up past the wait. */
async function readPage(link: DcardLink, signal: AbortSignal | undefined): Promise<DcardPageRead> {
  let raw: unknown;
  try {
    raw = await withSitePage('dcard', link.url, signal, (page) => page.waitFor(pageProbe(link.id), PAGE_WAIT_MS));
  } catch (err) {
    signal?.throwIfAborted();
    const why = err instanceof SitePageTimeout ? 'the page did not settle in time' : err instanceof Error ? err.message : String(err);
    throw new FlowUserError('flow.error.xPageUnreadable', { url: link.url }, `Dcard: ${why}: ${link.url}`);
  }
  let read: DcardPageRead;
  try {
    read = JSON.parse(String(raw)) as DcardPageRead;
  } catch {
    throw new FlowUserError('flow.error.xPageUnreadable', { url: link.url }, `Dcard: the page answered something unreadable: ${link.url}`);
  }
  if (read.phase === 'challenge') sendLog(`🗂️ [Dcard] The page's challenge was still up after ${CHALLENGE_WAIT_MS / 1_000} s`);
  return read;
}

/**
 * The page past its challenge. One that wants a click: the person answers it in a window when they
 * started this read at the computer, and the page is read again; otherwise the read fails with
 * "needs a one-time verification" and a notification offers the window.
 */
async function readPassedPage(link: DcardLink, signal: AbortSignal | undefined, interactive: boolean): Promise<DcardPageRead> {
  const first = await readPage(link, signal);
  if (first.phase !== 'challenge') return first;
  const request = { site: 'dcard', partition: sitePagePartition('dcard'), url: link.url, isCleared };
  if (!interactive) throw offerSiteVerification(request);
  await requestSiteVerification({ ...request, signal });
  const again = await readPage(link, signal);
  if (again.phase === 'challenge') throw throttled(link, 'still challenged the page after the verification passed');
  return again;
}

/** The post as the page gave it: its own Next.js data, else the API's answer, else the ld+json, else the head. */
export function postFromPage(read: DcardPageRead, link: DcardLink): { post: XPost | null; ldComments: XPost[]; source: string } {
  // The API says there is no such post: the page around it is Dcard's "not found", not the post.
  if (read.status === 404) return { post: null, ldComments: [], source: 'none' };
  const ld = dcardPostFromLd(read.ld ?? [], link.id, link.url);
  const ldComments = ld?.comments ?? [];
  const rendered = read.next ? dcardPostFromNextData(read.next, link.id, link.url) : null;
  if (rendered) return { post: rendered, ldComments, source: 'page data' };
  if (read.status === 200 && read.api) {
    try {
      const post = dcardPostFromApi(JSON.parse(read.api), link.id, link.url);
      if (post) return { post, ldComments, source: 'api' };
    } catch {
      // Not JSON after all: the page's own copy below.
    }
  }
  if (ld) return { post: ld.post, ldComments, source: 'ld+json' };
  const head = read.meta ? dcardPostFromMeta(read.meta, link.id, link.url) : null;
  return { post: head, ldComments: [], source: head ? 'og' : 'none' };
}

async function getJson(url: string, signal: AbortSignal | undefined): Promise<unknown> {
  const { status, text } = await fetchRawResponse(url, {
    headers: {
      'User-Agent': userAgentForUrl(url),
      Accept: 'application/json',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Site': 'same-origin',
    },
    validateRedirectHost: stayOnDcard,
    // The cookies the reader's page earned go along; with them a same-origin request needs an origin.
    cookiesFrom: session.fromPartition(sitePagePartition('dcard')),
    origin: ORIGIN,
    signal,
  });
  if (status >= 400) throw new Error(`HTTP ${status}`);
  return JSON.parse(text) as unknown;
}

/**
 * The 100 most-liked comments, each of the most-liked few followed by its replies. A list that
 * cannot be read is no comments (logged); a reply page that cannot be read is no replies.
 */
async function readComments(id: string, postLink: string, signal: AbortSignal | undefined): Promise<XPost[]> {
  const base = `${ORIGIN}/service/api/v3/posts/${id}/comments`;
  const top = dcardComments(await getJson(`${base}?sort=likes&limit=${MAX_COMMENTS}`, signal), postLink).slice(0, MAX_COMMENTS);
  const parents = top.filter((c) => c.post.replyCount > 0).slice(0, REPLY_PARENTS);
  const replies = new Map<string, DcardComment[]>();
  for (const parent of parents) {
    const url = `${base}?parentId=${encodeURIComponent(parent.post.id)}&sort=oldest&limit=${REPLIES_PER_PARENT}`;
    try {
      replies.set(parent.post.id, dcardComments(await getJson(url, signal), postLink, parent).slice(0, REPLIES_PER_PARENT));
    } catch (err) {
      signal?.throwIfAborted();
      sendLog(`🗂️ [Dcard] Replies under B${parent.floor} unreadable: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return top.flatMap((c) => [c.post, ...(replies.get(c.post.id) ?? []).map((r) => r.post)]);
}

/**
 * The post and, when `comments`, the comments the analysis reads; `value` null when the page
 * held no post (404 when Dcard says there is none). `signal` (a flow's Stop) closes the hidden
 * window and aborts the request in flight.
 */
export async function readDcardThread(
  url: string,
  { comments, signal, interactive = false }: { comments: boolean; signal?: AbortSignal; interactive?: boolean },
): Promise<XRead<XThread>> {
  const link = parseDcardUrl(url);
  if (!link) return { status: 400, value: null };
  const read = await readPassedPage(link, signal, interactive);
  const { post, ldComments, source } = postFromPage(read, link);
  // The API rate-limited the page and it showed nothing else: a pause, not a missing post.
  if (!post && read.status === 429) throw throttled(link, 'answered 429 (too many requests)');
  if (!post) {
    sendLog(`🗂️ [Dcard] No post on the page (API ${read.status ?? 0}): ${link.url}`);
    return { status: read.status === 404 ? 404 : 200, value: null };
  }
  let replies: XPost[] = [];
  if (comments) {
    replies = await readComments(link.id, post.link, signal).catch((err: unknown) => {
      // A Stop is not an unreadable list: it ends the read.
      signal?.throwIfAborted();
      sendLog(`🗂️ [Dcard] Comments unreadable (${err instanceof Error ? err.message : String(err)}); ${ldComments.length} from the page instead`);
      return ldComments;
    });
  }
  sendLog(`🗂️ [Dcard] Read from the ${source} — ${post.media.length} media, ${replies.length} comment(s)`);
  return { status: 200, value: { focal: post, replies } };
}
