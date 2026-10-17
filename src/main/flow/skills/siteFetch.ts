import { net } from 'electron';
import { userAgentForUrl } from '../../userAgent';

/**
 * What the link-site readers (Threads, Instagram, Facebook) share when they fetch a site's page
 * themselves: the headers that make the page answer as it does to a browser, the redirect guard
 * that keeps a read on the site's own hosts, and reading where a share link points.
 */

/**
 * The headers of a browser opening the page, which the post readers' sites answer with the full
 * page. No Accept-Language: the session's own goes out, the same as its sign-in window's.
 */
export const NAVIGATION_HEADERS = {
  Accept: 'text/html,application/xhtml+xml',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Site': 'none',
} as const;

/**
 * A `validateRedirectHost` guard: a redirect off the site's own hosts ends the read with
 * "<site> redirected to <host>".
 */
export function stayOnHosts(site: string, isHost: (host: string) => boolean): (host: string) => void {
  return (host) => {
    if (!isHost(host)) throw new Error(`${site} redirected to ${host}`);
  };
}

const SHORT_LINK_TIMEOUT_MS = 10_000;

/**
 * Where a share link (`b23.tv/<code>`) points, read from its redirect without following it: the
 * `Location` it answers with, or null when it answers 200 without one (bilibili's expired codes).
 * Rejects on any other status, a network failure, after 10 s, and with the
 * signal's reason on Stop. No cookie goes out.
 */
export function resolveShortLink(url: string, signal?: AbortSignal): Promise<string | null> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const request = net.request({ url, method: 'GET', redirect: 'manual' });
    request.setHeader('User-Agent', userAgentForUrl(url));
    for (const [name, value] of Object.entries(NAVIGATION_HEADERS)) request.setHeader(name, value);
    let settled = false;
    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      settle();
    };
    const onAbort = (): void => {
      finish(() => reject(signal?.reason));
      request.abort();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new Error(`${url} did not answer within ${SHORT_LINK_TIMEOUT_MS / 1_000} s`)));
      request.abort();
    }, SHORT_LINK_TIMEOUT_MS);
    signal?.addEventListener('abort', onAbort, { once: true });
    request.on('redirect', (_status, _method, location) => {
      finish(() => resolve(location));
      request.abort();
    });
    request.on('response', (response) => {
      response.on('data', () => {});
      // Only a 200 means "no such code"; a 412 (the site's check), 404 or 5xx says nothing about it.
      const status = response.statusCode;
      finish(() => (status === 200 ? resolve(null) : reject(new Error(`${url} answered ${status}`))));
    });
    request.on('error', (err) => finish(() => reject(err)));
    request.end();
  });
}
