import { fetchRawResponse } from '../../pageLoader';
import { userAgentForUrl } from '../../userAgent';
import { parseAppStorePage, readAppStorePage } from './appStorePosts';
import type { AppStoreApp } from './appStorePosts';
import type { PostLink } from './postReader';
import { NAVIGATION_HEADERS, stayOnHosts } from './siteFetch';
import type { XThread } from './xPosts';
import type { XRead } from './xReader';

const stayOnAppStore = stayOnHosts('App Store', (host) => host === 'apps.apple.com');

function getAppPage(url: string, signal: AbortSignal | undefined): Promise<{ status: number; text: string }> {
  return fetchRawResponse(url, {
    headers: { 'User-Agent': userAgentForUrl(url), ...NAVIGATION_HEADERS },
    validateRedirectHost: stayOnAppStore,
    signal,
  });
}

/**
 * An app's App Store page, signed out, with one plain request: the card and the description are
 * in the page itself. `value` is null when the page held no app (a 404: the app is not sold in that
 * storefront, or is gone). `signal` (a flow's Stop) aborts the request in flight.
 */
export async function readAppStoreThread(link: PostLink, signal?: AbortSignal): Promise<XRead<XThread>> {
  const { status, text } = await getAppPage(link.url, signal);
  return { status, value: status < 400 ? readAppStorePage(text, link.url, link.id) : null };
}

/** The same page read as the app's data, for the App Store step. */
export async function readAppStoreApp(url: string, id: string, signal?: AbortSignal): Promise<XRead<AppStoreApp>> {
  const { status, text } = await getAppPage(url, signal);
  return { status, value: status < 400 ? parseAppStorePage(text, url, id) : null };
}
