import { BrowserWindow, net } from 'electron';
import { TextDecoder } from 'node:util';
import { userAgentForUrl } from './userAgent';
import { loadURLFollowingIdentity } from './navigationIdentity';
import { SILENT_WEB_PREFERENCES, muteWindow } from './silentWindow';
import { guardPublicOnly, markHeadless, unguardPublicOnly, unmarkHeadless } from './requestFilter';
import { appendLogLine, fileStamp } from './logFile';
import { withTimeout } from './promiseRace';
import {
  assertPublicHostLiteral, assertPublicWebUrl, followPublicRedirects, isPublicWebOnly,
  PrivateAddressRefusedError,
} from './net/publicWebScope';
import type { RawHop } from './net/publicWebScope';

const LOAD_TIMEOUT_MS = 25_000;

const RAW_FETCH_TIMEOUT_MS = 15_000;

/**
 * The largest body a raw fetch keeps. The biggest honest answers it reads are long podcast feeds
 * and video pages of a few MB; past this the body is a server streaming at us, and every byte
 * would sit in memory (then be decoded and parsed) until the 15 s ceiling.
 */
const RAW_FETCH_MAX_BYTES = 10 * 1_048_576;

/** The longest a loaded page gets to finish drawing before its DOM is read. */
const JS_SETTLE_MS = 1_500;

/** How often a loaded page's text length is read. */
const SETTLE_POLL_MS = 250;

/**
 * Equal reads in a row that call a page done. Three, not two: a page that draws its menus at
 * load and its article over a request that lands a moment later holds still for one poll.
 */
const SETTLE_STABLE_READS = 3;

/**
 * The least body text (menus included) a stable page has to show to be read before JS_SETTLE_MS:
 * below it the page may still be an empty app shell waiting on its data. Search's own threshold
 * for a readable page is the same number of cleaned characters.
 */
const MIN_TEXT_CHARS = 400;

const TEXT_LENGTH_SCRIPT = 'document.body ? document.body.innerText.length : 0';

const JS_EXEC_TIMEOUT_MS = 10_000;
export const URL_PARSER_PARTITION = 'persist:url-parser';

export function ensureHttpScheme(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export interface RawFetchOptions {
  headers?: Record<string, string>;
  validateRedirectHost?: (host: string) => void;
  /**
   * Sends the cookies this session holds for the URL, as a page open in it would: a site the
   * user signed in to in its own partition. Without it no cookie goes out.
   */
  cookiesFrom?: Electron.Session;
  /**
   * The page origin the request comes from, for an API that wants a same-origin call. Chromium
   * refuses (`net::ERR_INVALID_ARGUMENT`) a cookie-carrying request that sets
   * `Sec-Fetch-Site: same-origin` without one.
   */
  origin?: string;
  /** A form POST, for an API the site's own pages call that way; GET when unset. */
  post?: { contentType: string; body: string };
  /** Aborts the request and rejects with the signal's reason: a flow's Stop ends the read. */
  signal?: AbortSignal;
  /**
   * `no-store` for an answer that varies with a header the site may not list in `Vary` (a markdown
   * answer stored without `Vary: Accept` comes back to the next plain read of the URL).
   */
  cache?: Electron.ClientRequestConstructorOptions['cache'];
}

/** What a stopped read rejects with: the signal's own reason, or a plain error when it has none. */
function abortReason(signal: AbortSignal, fallback = 'Raw fetch aborted'): Error {
  return signal.reason instanceof Error ? signal.reason : new Error(fallback);
}

export interface RawFetchResponse {
  status: number;
  text: string;
  /**
   * Where the answer came from after the redirects `validateRedirectHost` let through (the URL
   * asked for without that option): a share link names its post only there.
   */
  finalUrl: string;
  /** Lower-case names, the first value of a repeated header. */
  headers?: Readonly<Record<string, string>>;
}

export async function fetchRawText(url: string, options?: RawFetchOptions): Promise<string> {
  return (await fetchRawResponse(url, options)).text;
}

/**
 * Resolves for every HTTP status; the caller decides what an error status means. Under a bot
 * message (`isPublicWebOnly`) every hop is resolved and refused when private before it is sent.
 */
export async function fetchRawResponse(url: string, options?: RawFetchOptions): Promise<RawFetchResponse> {
  const start = ensureHttpScheme(url);
  if (!isPublicWebOnly()) return responseOf(await requestRaw(start, options, false));
  const { response, finalUrl } = await followPublicRedirects(
    start,
    options?.validateRedirectHost,
    // A redirect that turns the request into a GET (301/302/303) drops the form body.
    (hopUrl, method) => requestRaw(hopUrl, method === 'GET' ? { ...options, post: undefined } : options, true),
  );
  return { ...response, finalUrl };
}

function responseOf(hop: RawHop<RawFetchResponse>): RawFetchResponse {
  if ('response' in hop) return hop.response;
  throw new Error(`Unexpected redirect to ${hop.redirectTo}`);
}

/**
 * One request. With `stopAtRedirect` a redirect ends it with the target instead of being followed,
 * for `followPublicRedirects` to check before the next hop.
 */
function requestRaw(
  url: string,
  options: RawFetchOptions | undefined,
  stopAtRedirect: boolean,
): Promise<RawHop<RawFetchResponse>> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const guard = options?.validateRedirectHost;
    const cookiesFrom = options?.cookiesFrom;
    const post = options?.post;
    const signal = options?.signal;
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    let finalUrl = url;
    const request = net.request({
      url: finalUrl,
      method: post ? 'POST' : 'GET',
      redirect: guard || stopAtRedirect ? 'manual' : 'follow',
      ...(cookiesFrom ? { session: cookiesFrom, useSessionCookies: true } : {}),
      ...(options?.origin ? { origin: options.origin } : {}),
      ...(options?.cache ? { cache: options.cache } : {}),
    });
    for (const [name, value] of Object.entries(options?.headers ?? {})) request.setHeader(name, value);
    if (post) request.setHeader('Content-Type', post.contentType);
    const chunks: Buffer[] = [];

    // Every way the request settles goes through here: the timer and the Stop listener both go.
    const settle = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = (): void => {
      settle();
      request.abort();
      if (signal) reject(abortReason(signal));
    };

    if (stopAtRedirect) {
      request.on('redirect', (_status, method, redirectUrl) => {
        settle();
        request.abort();
        resolve({ redirectTo: redirectUrl, method });
      });
    } else if (guard) {
      request.on('redirect', (_status, _method, redirectUrl) => {
        let host = '';
        try {
          host = new URL(redirectUrl).hostname.toLowerCase();
          guard(host);
        } catch (err) {
          settle();
          request.abort();
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        // Tracked only here: a request that follows redirects on its own never reports them.
        finalUrl = redirectUrl;
        request.followRedirect();
      });
    }

    request.on('response', (response) => {
      let received = 0;
      let overflowed = false;
      response.on('data', (chunk: Buffer) => {
        if (overflowed) return;
        received += chunk.length;
        if (received > RAW_FETCH_MAX_BYTES) {
          overflowed = true;
          settle();
          request.abort();
          reject(new Error(`Raw fetch body exceeded ${RAW_FETCH_MAX_BYTES / 1_048_576} MB`));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (overflowed) return;
        settle();
        resolve({
          response: {
            status: response.statusCode,
            text: decodeBody(Buffer.concat(chunks), headerValue(response.headers['content-type'])),
            finalUrl,
            headers: firstHeaderValues(response.headers),
          },
        });
      });
      response.on('error', (err: Error) => {
        settle();
        reject(err);
      });
    });

    request.on('error', (err: Error) => {
      settle();
      reject(err);
    });

    // Armed only once `request` exists: a throwing net.request must leave no timer behind.
    timer = setTimeout(() => {
      settle();
      request.abort();
      reject(new Error(`Raw fetch timed out after ${RAW_FETCH_TIMEOUT_MS / 1_000}s`));
    }, RAW_FETCH_TIMEOUT_MS);
    signal?.addEventListener('abort', onAbort, { once: true });

    request.end(post?.body);
  });
}

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function firstHeaderValues(headers: Record<string, string | string[]>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), headerValue(value)]));
}

function decodeBody(body: Buffer, contentType: string): string {
  const label = charsetOf(contentType) ?? sniffCharset(body) ?? 'utf-8';
  if (/^utf-?8$/i.test(label)) return body.toString('utf8');
  try {
    return new TextDecoder(label).decode(body);
  } catch {
    return body.toString('utf8');
  }
}

function charsetOf(contentType: string): string | null {
  const match = /charset=["']?([\w.:-]+)/i.exec(contentType);
  return match ? match[1] : null;
}

function sniffCharset(body: Buffer): string | null {
  const head = body.subarray(0, 2_048).toString('latin1');
  const meta = /<meta[^>]+charset=["']?([\w.:-]+)/i.exec(head);
  if (meta) return meta[1];
  const xml = /<\?xml[^>]+encoding=["']([\w.:-]+)/i.exec(head);
  return xml ? xml[1] : null;
}

export interface PageLoadResult {
  html: string;
  finalUrl: string;
}

export async function loadPageHtml(
  url: string,
  validateRedirectHost?: (host: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  return (await loadPageResult(url, validateRedirectHost, signal)).html;
}

async function snapshotDom(win: BrowserWindow): Promise<PageLoadResult> {
  const html = (await withTimeout(
    win.webContents.executeJavaScript('document.documentElement.innerHTML'),
    JS_EXEC_TIMEOUT_MS,
    () => new Error(`DOM serialization timed out after ${JS_EXEC_TIMEOUT_MS / 1_000}s`),
  )) as string;
  return { html, finalUrl: win.webContents.getURL() };
}

/**
 * Under a bot message (`isPublicWebOnly`) the window reads the public web only: the address is
 * resolved and checked before the window exists; the request filter then checks every request the
 * window makes (each redirect hop of the page included, since Electron runs `onBeforeRequest`
 * again per hop) and a refused page fails the load; `will-redirect` refuses private literals
 * synchronously as a second line; popups are denied; and the address the page ended on is checked
 * again before its DOM is read.
 *
 * Residual: Chromium resolves names itself, after our lookup. A name that answers public to us and
 * private to Chromium a moment later (DNS rebinding) passes; the final-URL check narrows it but
 * cannot see the address Chromium connected to.
 *
 * An aborted `signal` destroys the window at once and rejects with the signal's reason.
 */
export function loadPageResult(
  url: string,
  validateRedirectHost?: (host: string) => void,
  signal?: AbortSignal,
): Promise<PageLoadResult> {
  if (!isPublicWebOnly()) return openPageWindow(url, validateRedirectHost, false, signal);
  return assertPublicWebUrl(url).then(() => openPageWindow(url, validateRedirectHost, true, signal));
}

function openPageWindow(
  url: string,
  validateRedirectHost: ((host: string) => void) | undefined,
  publicOnly: boolean,
  signal: AbortSignal | undefined,
): Promise<PageLoadResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal, 'Page load aborted'));
      return;
    }
    let settled = false;
    let domReady = false;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    // Every way the load settles goes through here: the settle ceiling and the text poll both stop.
    const stopSettling = (): void => {
      if (settleTimer) clearTimeout(settleTimer);
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = null;
    };

    const win = new BrowserWindow({
      x: -20_000,
      y: -20_000,
      width: 1_280,
      height: 900,
      show: false,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        partition: URL_PARSER_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
        disableDialogs: true,
        ...SILENT_WEB_PREFERENCES,
      },
    });

    win.webContents.setUserAgent(userAgentForUrl(url));
    muteWindow(win);
    // Electron has no popup blocker: a window.open() from the page would show a real window.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    // Nobody looks at this window, so the request filter may drop frames, images and fonts.
    const contentsId = win.webContents.id;
    markHeadless(contentsId);

    // Also while the DOM is being read out (`settled` already set): that read can wait up to
    // JS_EXEC_TIMEOUT_MS on a page that has stopped answering, and its result is not wanted now.
    const onAbort = (): void => {
      if (!signal) return;
      settled = true;
      stopSettling();
      clearTimeout(timeout);
      teardown();
      reject(abortReason(signal, 'Page load aborted'));
    };

    const teardown = (): void => {
      signal?.removeEventListener('abort', onAbort);
      unmarkHeadless(contentsId);
      unguardPublicOnly(contentsId);
      safeDestroy(win);
    };

    const fail = (err: unknown): void => {
      if (settled) return;
      settled = true;
      stopSettling();
      clearTimeout(timeout);
      teardown();
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    const finish = async (): Promise<void> => {
      try {
        // The page may have moved itself somewhere else since it was checked.
        if (publicOnly) await assertPublicWebUrl(win.webContents.getURL());
        const result = await snapshotDom(win);
        teardown();
        resolve(result);
      } catch (err) {
        teardown();
        reject(err);
      }
    };

    if (publicOnly) {
      guardPublicOnly(contentsId, (refusedUrl) => fail(new PrivateAddressRefusedError(refusedUrl)));
    }

    if (validateRedirectHost || publicOnly) {
      const guardNavigation = (event: Electron.Event, targetUrl: string): void => {
        try {
          const host = new URL(targetUrl).hostname.toLowerCase();
          if (publicOnly) assertPublicHostLiteral(host, targetUrl);
          validateRedirectHost?.(host);
        } catch (err) {
          event.preventDefault();
          fail(err);
        }
      };
      win.webContents.on('will-redirect', guardNavigation);
      win.webContents.on('will-navigate', guardNavigation);
    }

    // On timeout, salvage the DOM if it is ready: on ad-heavy pages third-party frames can keep
    // `load` from ever firing.
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      stopSettling();
      if (domReady) {
        appendLogLine(`[${fileStamp(new Date())}] ⚠️ [Page] load never fired within ${LOAD_TIMEOUT_MS / 1_000}s, serializing the DOM as it stands: ${url}`);
        void finish();
        return;
      }
      teardown();
      reject(new Error(`Page load timed out after ${LOAD_TIMEOUT_MS / 1_000}s`));
    }, LOAD_TIMEOUT_MS);

    win.webContents.on('dom-ready', () => {
      domReady = true;
    });

    const settleNow = (): void => {
      if (settled) return;
      settled = true;
      stopSettling();
      clearTimeout(timeout);
      void finish();
    };

    // A page that needs JS to draw its text is read once its text length holds still across
    // SETTLE_STABLE_READS polls, or at JS_SETTLE_MS at the latest. A failed poll (the window is
    // going away) leaves it to the ceiling.
    let lastLength = -1;
    let sameReads = 0;
    const pollText = (): void => {
      pollTimer = setTimeout(async () => {
        pollTimer = null;
        if (settled) return;
        let length = -1;
        try {
          const read: unknown = await win.webContents.executeJavaScript(TEXT_LENGTH_SCRIPT);
          if (typeof read === 'number') length = read;
        } catch {
          return;
        }
        if (settled) return;
        sameReads = length === lastLength ? sameReads + 1 : 1;
        lastLength = length;
        if (length >= MIN_TEXT_CHARS && sameReads >= SETTLE_STABLE_READS) {
          settleNow();
          return;
        }
        pollText();
      }, SETTLE_POLL_MS);
    };

    // A later load in the same window (the page moved itself) keeps the first ceiling, as the
    // earliest timer always won.
    win.webContents.on('did-finish-load', () => {
      if (settled || settleTimer) return;
      settleTimer = setTimeout(settleNow, JS_SETTLE_MS);
      pollText();
    });

    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (settled) return;
      if (!isMainFrame) return;
      if (errorCode === -3) return;
      settled = true;
      clearTimeout(timeout);
      stopSettling();
      teardown();
      reject(new Error(`Failed to load page: ${errorDescription} (${errorCode})`));
    });

    loadURLFollowingIdentity(win.webContents, url).catch((err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      stopSettling();
      teardown();
      reject(err);
    });
  });
}

function safeDestroy(win: BrowserWindow): void {
  try {
    if (!win.isDestroyed()) win.destroy();
  } catch {
  }
}
