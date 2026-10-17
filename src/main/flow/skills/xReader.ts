import { fetchRawResponse } from '../../urlParser';
import { sendLog } from '../../helpers';
import { getSiteAccountStatus } from '../../siteAccounts';
import { readSsrGraphql, type XGraphqlResult } from './xSsr';
import { readSignedInXPage } from './xSignedIn';
import {
  hasTrendingTimeline, postLink, readProfilePosts, readSearchPosts, readThread, readTrends,
  type XPost, type XThread, type XTrend,
} from './xPosts';

/**
 * Reading x.com, shared by the flow steps and the X connector: signed in to X in Settings, a page
 * is read as the user sees it; anything that goes wrong there falls back to the public page.
 */

export interface XRead<T> {
  status: number;
  value: T | null;
}

/** Thrown when an answer only exists signed in — X's search and Explore pages redirect everyone else to sign-in. */
export class XSignInRequiredError extends Error {
  constructor(what = 'Searching X') {
    super(`${what} needs an X sign-in (Settings › Connectors › X). Reading an account's posts or a post's replies works without one.`);
    this.name = 'XSignInRequiredError';
  }
}

/** The public, signed-out page; X embeds a limited timeline in its HTML. */
async function readPublicPage<T>(url: string, pick: (results: XGraphqlResult[]) => T | null, signal?: AbortSignal): Promise<XRead<T>> {
  const { status, text } = await fetchRawResponse(url, signal ? { signal } : undefined);
  return { status, value: pick(readSsrGraphql(text)) };
}

/**
 * `signal` (a flow's Stop) ends the read: a stopped signed-in read does not fall back to the public
 * page. `signedIn` false: the public page alone, whether or not X is signed in (`SiteReadOptions.signedIn`).
 */
async function readXPage<T>(
  url: string,
  pick: (results: XGraphqlResult[]) => T | null,
  signal?: AbortSignal,
  signedIn = true,
): Promise<XRead<T>> {
  if (signedIn && await getSiteAccountStatus('x').catch(() => false)) {
    try {
      const page = await readSignedInXPage(url, (results) => pick(results) !== null, undefined, signal);
      const value = pick(page.results);
      if (value !== null) {
        sendLog(`🐦 [Flow] X: read signed in — ${url} (${page.results.length} result(s))`);
        return { status: page.status, value };
      }
      sendLog(`🐦 [Flow] X: the signed-in page held nothing readable (HTTP ${page.status}, ${page.results.length} result(s); page called: ${page.operations.join(', ') || 'no GraphQL'}) — reading the public page instead`);
    } catch (err) {
      signal?.throwIfAborted();
      sendLog(`🐦 [Flow] X: signed-in read failed: ${err instanceof Error ? err.message : String(err)} — reading the public page instead`);
    }
  }
  return readPublicPage(url, pick, signal);
}

/** The account's own newest posts, newest first; reposts of others left out. `value` is null when the page held no timeline. */
export async function readAccountPosts(handle: string, limit: number): Promise<XRead<XPost[]>> {
  const page = await readXPage(`https://x.com/${handle}`, (results) => readProfilePosts(results, handle));
  if (!page.value) return { status: page.status, value: null };
  const posts = page.value
    .map(({ post }) => (post.author ? post : { ...post, author: handle, link: postLink(handle, post.id) }))
    .filter((post) => !post.isRepost && post.author.toLowerCase() === handle.toLowerCase())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
  return { status: page.status, value: posts };
}

/** A post and its replies; `signedIn` false reads it as a visitor even when X is signed in. */
export async function readPostThread(ref: { author: string; id: string }, signal?: AbortSignal, signedIn = true): Promise<XRead<XThread>> {
  return readXPage(postLink(ref.author, ref.id), (results) => readThread(results, ref.id), signal, signedIn);
}

/** The first page of a search, in X's order. Signed in only — the caller checks. */
async function readSearchPage(url: string): Promise<XPost[]> {
  const page = await readSignedInXPage(url, (results) => readSearchPosts(results) !== null);
  const posts = readSearchPosts(page.results);
  if (!posts) {
    throw new Error(`X search returned nothing readable (HTTP ${page.status}; page called: ${page.operations.join(', ') || 'no GraphQL'})`);
  }
  return posts;
}

/** The newest posts matching `query` ("Latest" tab). Signed in only. */
export async function searchXPosts(query: string): Promise<XPost[]> {
  if (!(await getSiteAccountStatus('x').catch(() => false))) throw new XSignInRequiredError();
  const posts = await readSearchPage(`https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`);
  sendLog(`🐦 X: searched "${query}" — ${posts.length} post(s)`);
  return posts;
}

/** What opening a trend on X shows: its "Top" posts, X's own pick of what the trend is about. Signed in only — the caller checks. */
export async function readTrendPosts(trend: XTrend): Promise<XPost[]> {
  return readSearchPage(trend.link);
}

const TRENDS_URL = 'https://x.com/explore/tabs/trending';

/** The Trending tab's timeline, with the "For you" query as a fallback when the tab never loads. */
const TRENDS_QUERIES = /\/i\/api\/graphql\/[^/]+\/(?:GenericTimelineById|ExplorePage)(?:\?|$)/;

/** What is trending on X for the signed-in account's region (Explore › Trending). Signed in only. */
export async function readXTrends(): Promise<XTrend[]> {
  if (!(await getSiteAccountStatus('x').catch(() => false))) throw new XSignInRequiredError('Reading X trends');
  const page = await readSignedInXPage(TRENDS_URL, hasTrendingTimeline, TRENDS_QUERIES);
  const trends = readTrends(page.results);
  if (!trends) {
    throw new Error(`X trends page held no trend (HTTP ${page.status}; page called: ${page.operations.join(', ') || 'no GraphQL'})`);
  }
  sendLog(`🐦 X: read ${trends.length} trend(s)`);
  return trends;
}

export { formatPostTime } from './xPosts';
