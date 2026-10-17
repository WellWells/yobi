import { BrowserWindow, session } from 'electron';
import { Semaphore } from './flow/lanes';
import { isBlockedHost } from './requestBlocklist';
import { SILENT_WEB_PREFERENCES, muteWindow, parkWindowOffscreen } from './silentWindow';
import { prepareSiteWindow } from './siteWindowIdentity';
import { userAgentForUrl } from './userAgent';
import { siteLabel } from '../shared/linkSites/rows';
import { bySite } from '../shared/siteConnectors';

/*
 * A site's page read in a hidden window, for sites whose pages only answer a real browser
 * (bilibili, Dcard, and Vimeo when Yobi's own request is turned away).
 *
 * Two partitions per site (one for a site Yobi has no sign-in for: Dcard, Vimeo), neither shared
 * with the AI worker. The reader's never holds a sign-in and is the only one yt-dlp gets cookies
 * from; the sign-in's (the site's connector) is read in these windows only, never handed to
 * yt-dlp. Each window is muted, cannot open others, and has the site's media streams cancelled.
 * One page per partition at a time, and a Stop ends the read at once.
 */

/** A request a reader's page makes, as the media filter sees it. */
export interface SitePageRequest {
  url: string;
  resourceType: string;
}

interface SitePageSpec {
  /** Where the site's pages are read signed out; the only partition yt-dlp gets cookies from. */
  reader: string;
  /** The site's sign-in (its connector's partition): read in Yobi's own windows only. None for a site Yobi has no sign-in for. */
  account?: string;
  /** Requests the page would make for the media itself: cancelled, the read needs none of them. */
  blocks(request: SitePageRequest): boolean;
  /**
   * Whether the window gets Google Chrome's whole identity before its first page, as a sign-in
   * window does (`prepareSiteWindow`): for a site whose bot check reads the page's own script.
   */
  chromeIdentity?: boolean;
}

/** bilibili's DASH segments and the CDN hosts serving them. */
export function isBilibiliMediaRequest(url: string): boolean {
  return /\.m4s(?:[?#]|$)|bilivideo\.|\/\/upos-|akamaized\./i.test(url);
}

/** Vimeo's media servers (HLS/DASH segments, progressive files); the player's page and scripts are elsewhere. */
export function isVimeoMediaRequest(url: string): boolean {
  return /^https?:\/\/(?:vod-[\w-]+|skyfire)\.vimeocdn\.com\//i.test(url);
}

/** Reddit's video: v.redd.it's playlists and files, and the packaged mp4s. */
export function isRedditMediaRequest(url: string): boolean {
  return /\/\/(?:v|packaged-media)\.redd\.it\//i.test(url);
}

const HEAVY_RESOURCES = new Set(['image', 'media', 'font']);

/**
 * What a Dcard reader's page fetches that the read never uses: pictures, video and fonts (the post
 * comes from its JSON), and the trackers on the shared blocklist. Cloudflare's own challenge
 * (`challenges.cloudflare.com`, the page's `/cdn-cgi/`) is never cut, whatever it loads.
 */
export function isDcardHeavyRequest({ url, resourceType }: SitePageRequest): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (host === 'challenges.cloudflare.com' || parsed.pathname.startsWith('/cdn-cgi/')) return false;
  return HEAVY_RESOURCES.has(resourceType) || (resourceType !== 'mainFrame' && isBlockedHost(host));
}

const SIGN_IN_PARTITIONS = bySite((row) => row.partition);

/*
 * Vimeo's reader keeps its cookies in memory only (nothing on disk, as TikTok's reader): a passed
 * challenge spares the next reads until the app quits, and factory reset or a backup has nothing
 * of it to handle.
 */
const SITE_PAGES = {
  bilibili: {
    reader: 'persist:bilibili-reader',
    account: SIGN_IN_PARTITIONS.bilibili,
    blocks: ({ url }: SitePageRequest) => isBilibiliMediaRequest(url),
  },
  dcard: { reader: 'persist:dcard-reader', blocks: isDcardHeavyRequest, chromeIdentity: true },
  // Persistent too: a passed check's cookie serves later reads and restarts.
  reddit: { reader: 'persist:reddit-reader', blocks: ({ url }: SitePageRequest) => isRedditMediaRequest(url), chromeIdentity: true },
  vimeo: { reader: 'vimeo-reader', blocks: ({ url }: SitePageRequest) => isVimeoMediaRequest(url), chromeIdentity: true },
} as const satisfies Record<string, SitePageSpec>;

export type SitePageSite = keyof typeof SITE_PAGES;

/**
 * The readers' partitions, for factory reset and session setup alongside `SITE_PARTITIONS`
 * (which holds the sign-in ones).
 */
export const READER_PARTITIONS: readonly string[] = Object.values(SITE_PAGES).map((spec) => spec.reader);

/** The reader's partition: the one yt-dlp gets its cookies from for that site. */
export function sitePagePartition(site: SitePageSite): string {
  return SITE_PAGES[site].reader;
}

/** Long enough for a first read that has to pass the site's script check, which reloads the page. */
export const SITE_PAGE_TIMEOUT_MS = 50_000;
/**
 * The whole read, the wait above and every script after it: a script the page never answers
 * (cut off by the check's reload, a fetch that hangs) must not hold the site's slot.
 */
export const SITE_PAGE_READ_MS = 60_000;
const POLL_MS = 200;

/** One slot per partition. */
const gates = new Map<string, Semaphore>();
/** The hidden windows' pages: only their requests are filtered, a sign-in window on the same session is not. */
const readers = new Set<number>();
const filtered = new Set<string>();

function gateFor(partition: string): Semaphore {
  let gate = gates.get(partition);
  if (!gate) {
    gate = new Semaphore(1);
    gates.set(partition, gate);
  }
  return gate;
}

/** The session's media filter, installed once (a session holds one `onBeforeRequest` listener). */
function installMediaFilter(site: SitePageSite, partition: string, ses: Electron.Session): void {
  if (filtered.has(partition)) return;
  filtered.add(partition);
  const spec: SitePageSpec = SITE_PAGES[site];
  ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    const reader = details.webContentsId !== undefined && readers.has(details.webContentsId);
    callback({ cancel: reader && spec.blocks({ url: details.url, resourceType: details.resourceType ?? '' }) });
  });
}

/** What a stopped read rejects with: the signal's own reason. */
function stopped(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('Site page read stopped');
}

export class SitePageTimeout extends Error {
  constructor(readonly site: SitePageSite, ms: number) {
    super(`The ${site} page did not answer within ${ms / 1_000} s`);
    this.name = 'SitePageTimeout';
  }
}

/** The open page, handed to a read. */
export interface SitePage {
  /** Runs `code` in the page's own world and returns what it evaluates to. */
  evaluate(code: string): Promise<unknown>;
  /**
   * Evaluates `code` until it gives something other than null or undefined, and returns that.
   * Throws `SitePageTimeout` past `ms`, the load's own error when the page failed to load, and the
   * signal's reason on Stop.
   */
  waitFor(code: string, ms?: number): Promise<unknown>;
}

/**
 * Opens `url` on the site's reader partition (never signed in) in a hidden, mapped, muted window
 * and hands the page to `read`; the window closes when `read` settles. One read per partition at
 * a time; waiting for the slot and reading both end on Stop, rejecting with the signal's reason,
 * and a read still going after `SITE_PAGE_READ_MS` rejects with `SitePageTimeout`.
 */
export function withSitePage<T>(
  site: SitePageSite,
  url: string,
  signal: AbortSignal | undefined,
  read: (page: SitePage) => Promise<T>,
): Promise<T> {
  const { reader } = SITE_PAGES[site];
  return holdingPartition(reader, signal, () => openAndRead(site, reader, url, signal, read));
}

/**
 * The same read on the site's sign-in partition (signed in or not), for what only an account is
 * given (bilibili's subtitles). Its own slot: it never waits for, or holds up, a reader's page.
 */
export function withAccountPage<T>(
  site: SitePageSite,
  url: string,
  signal: AbortSignal | undefined,
  read: (page: SitePage) => Promise<T>,
): Promise<T> {
  const { account }: SitePageSpec = SITE_PAGES[site];
  if (!account) return Promise.reject(new Error(`${site} has no sign-in to read a page with`));
  return holdingPartition(account, signal, () => openAndRead(site, account, url, signal, read));
}

/**
 * Earns a site's script-check cookie anew in the reader's partition (bilibili's
 * `X-BILI-SEC-TOKEN` after yt-dlp was refused with it): forgets the cookie, reads `url` until
 * `read` settles (the page passes the check, which sets a new one), and says whether the
 * partition holds the cookie afterwards. In the reader's one-at-a-time slot, so no other read
 * sees the cookie gone half-way.
 */
export function renewSitePageCookie(
  site: SitePageSite,
  url: string,
  name: string,
  signal: AbortSignal | undefined,
  read: (page: SitePage) => Promise<unknown>,
): Promise<boolean> {
  const { reader } = SITE_PAGES[site];
  return holdingPartition(reader, signal, async () => {
    const { cookies } = session.fromPartition(reader);
    await cookies.remove(url, name);
    await openAndRead(site, reader, url, signal, read);
    return (await cookies.get({ url, name })).length > 0;
  });
}

/** Runs `work` in the partition's slot; waiting for it ends on Stop with the signal's reason. */
async function holdingPartition<T>(partition: string, signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
  const gate = gateFor(partition);
  try {
    await gate.acquire(signal);
  } catch (err) {
    if (signal?.aborted) throw stopped(signal);
    throw err;
  }
  try {
    signal?.throwIfAborted();
    return await work();
  } finally {
    gate.release();
  }
}

async function openAndRead<T>(
  site: SitePageSite,
  partition: string,
  url: string,
  signal: AbortSignal | undefined,
  read: (page: SitePage) => Promise<T>,
): Promise<T> {
  const ses = session.fromPartition(partition);
  installMediaFilter(site, partition, ses);
  const win = new BrowserWindow({
    width: 1_280,
    height: 900,
    show: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    hiddenInMissionControl: process.platform === 'darwin',
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      disableDialogs: true,
      ...SILENT_WEB_PREFERENCES,
    },
  });
  const contentsId = win.webContents.id;
  readers.add(contentsId);
  muteWindow(win);
  win.webContents.setUserAgent(userAgentForUrl(url));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  let loadError = '';
  // A main-frame failure other than "aborted" (the check's own reload aborts the first load).
  win.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) loadError = `${description} (${code})`;
  });
  // A Stop or the read's deadline ends whatever the read is waiting on; the window itself closes
  // in `finally`, never from inside the abort event, which can take the whole app down.
  let end = (_reason: unknown): void => {};
  const ended = new Promise<never>((_resolve, reject) => {
    end = reject;
  });
  ended.catch(() => {});
  const onAbort = (): void => end(stopped(signal as AbortSignal));
  signal?.addEventListener('abort', onAbort, { once: true });
  const deadline = setTimeout(() => end(new SitePageTimeout(site, SITE_PAGE_READ_MS)), SITE_PAGE_READ_MS);

  const evaluate = async (code: string): Promise<unknown> => {
    signal?.throwIfAborted();
    if (win.isDestroyed()) throw new Error(`The ${site} page closed`);
    return Promise.race([win.webContents.executeJavaScript(code, true), ended]);
  };
  const waitFor = async (code: string, ms = SITE_PAGE_TIMEOUT_MS): Promise<unknown> => {
    const started = Date.now();
    while (Date.now() - started < ms) {
      signal?.throwIfAborted();
      if (loadError) throw new Error(`The ${site} page did not load: ${loadError}`);
      // Mid-navigation the page has no world to run in; the next poll tries again.
      const value = await evaluate(code).catch((err: unknown) => {
        if (signal?.aborted || win.isDestroyed() || err instanceof SitePageTimeout) throw err;
        return null;
      });
      if (value !== null && value !== undefined) return value;
      await Promise.race([new Promise((resolve) => setTimeout(resolve, POLL_MS)), ended]);
    }
    signal?.throwIfAborted();
    throw new SitePageTimeout(site, ms);
  };

  try {
    // Mapped, not merely created: a window that has never been shown stalls rendering, and with
    // it the page's own scripts (the check among them). Transparent before it is mapped: parking
    // moves it only once shown, so an opaque window would flash at its default spot first.
    win.setOpacity(0);
    const identity = (SITE_PAGES[site] as SitePageSpec).chromeIdentity === true;
    // A blank page first, BEFORE the window is shown: a window shown before it had a page keeps
    // every later page `document.hidden`, and the DevTools protocol needs a page before the
    // identity can be set.
    if (identity) await Promise.race([win.loadURL('about:blank'), ended]);
    win.showInactive();
    parkWindowOffscreen(win);
    if (identity) await Promise.race([prepareSiteWindow(win.webContents, siteLabel(site)), ended]);
    void win.loadURL(url).catch(() => {});
    return await Promise.race([read({ evaluate, waitFor }), ended]);
  } catch (err) {
    if (signal?.aborted) throw stopped(signal);
    throw err;
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', onAbort);
    if (!win.isDestroyed()) win.destroy();
    readers.delete(contentsId);
  }
}
