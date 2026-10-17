import { fetchRawResponse } from '../../pageLoader';
import { userAgentForUrl } from '../../userAgent';
import { isThreadsHost } from '../../../shared/threadsLinks';
import { NAVIGATION_HEADERS, stayOnHosts } from './siteFetch';
import { readThreadsThread } from './threadsPosts';
import type { XThread } from './xPosts';
import type { XRead } from './xReader';

/**
 * Threads sends the post's data only to what looks like a browser opening the page (see
 * `NAVIGATION_HEADERS`). A share link's redirect lands on the post.
 */
const stayOnThreads = stayOnHosts('Threads', isThreadsHost);

/** The post and its first direct replies; `value` is null when the page held no post. */
export async function readThreadsPostThread(url: string, signal?: AbortSignal): Promise<XRead<XThread>> {
  const { status, text } = await fetchRawResponse(url, {
    headers: { 'User-Agent': userAgentForUrl(url), ...NAVIGATION_HEADERS },
    validateRedirectHost: stayOnThreads,
    signal,
  });
  return { status, value: status < 400 ? readThreadsThread(text) : null };
}
