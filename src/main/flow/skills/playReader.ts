import { fetchRawResponse } from '../../pageLoader';
import { userAgentForUrl } from '../../userAgent';
import { parsePlayUrl } from '../../../shared/linkSites/playLinks';
import { parsePlayPage, readPlayPage } from './playPosts';
import type { PlayApp } from './playPosts';
import type { PostLink } from './postReader';
import { NAVIGATION_HEADERS, stayOnHosts } from './siteFetch';
import { playLabels, playReadUrl } from './storeRegion';
import type { XThread } from './xPosts';
import type { XRead } from './xReader';

const stayOnPlay = stayOnHosts('Google Play', (host) => host === 'play.google.com');

function getPlayPage(url: string, signal: AbortSignal | undefined): Promise<{ status: number; text: string }> {
  return fetchRawResponse(url, {
    headers: { 'User-Agent': userAgentForUrl(url), ...NAVIGATION_HEADERS },
    validateRedirectHost: stayOnPlay,
    signal,
  });
}

/**
 * An app's Google Play page, signed out, with one plain request, in the user's language and the
 * link's region (else the user's). `value` is null when the page held no app (a 404: no such
 * package, or not offered in that country). `signal` (a flow's Stop) aborts the request in flight.
 */
export async function readPlayThread(link: PostLink, signal?: AbortSignal): Promise<XRead<XThread>> {
  const region = parsePlayUrl(link.url)?.region ?? '';
  const url = playReadUrl(link.id, region);
  const { status, text } = await getPlayPage(url, signal);
  return { status, value: status < 400 ? readPlayPage(text, url, link.id, playLabels()) : null };
}

/** The same page read as the app's data, for the app store step. */
export async function readPlayApp(id: string, region: string, signal?: AbortSignal): Promise<XRead<PlayApp>> {
  const url = playReadUrl(id, region);
  const { status, text } = await getPlayPage(url, signal);
  return { status, value: status < 400 ? parsePlayPage(text, url, id, playLabels()) : null };
}
