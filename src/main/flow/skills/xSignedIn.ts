import { BrowserWindow } from 'electron';
import { CLEAN_UA } from '../../userAgent';
import { SILENT_WEB_PREFERENCES, muteWindow, parkWindowOffscreen } from '../../silentWindow';
import { siteSession } from '../../siteAccounts';
import { Semaphore } from '../lanes';
import { within } from '../../promiseRace';
import { readGraphqlResponse, readSsrGraphql, type XGraphqlResult } from './xSsr';

const LOAD_TIMEOUT_MS = 25_000;
/** Opening the window and attaching to it; either one stalling would otherwise hold the step to its own timeout. */
const SETUP_TIMEOUT_MS = 10_000;
/** How long to keep collecting after `ready` first holds, for results still arriving. */
const SETTLE_MS = 1_500;
const POLL_MS = 250;

/** The timeline and post GraphQL operations kept by default, whatever the deploy's query ids are. */
const GRAPHQL_RE = /\/i\/api\/graphql\/[^/]+\/(?:UserOriginalsTimeline|UserTweets|TweetDetail|SearchTimeline)(?:\?|$)/;

/** One signed-in X page at a time: every one of them is a request on the user's own account. */
const signedInGate = new Semaphore(1);

export interface XCapturedPage {
  status: number;
  results: XGraphqlResult[];
  /** Every GraphQL operation the page called, kept or not — what to look at when X renames one. */
  operations: string[];
}

const ANY_GRAPHQL_RE = /\/i\/api\/graphql\/[^/]+\/([A-Za-z]+)/;

interface Pending {
  url: string;
  kind: 'document' | 'graphql';
  status: number;
  postData?: string;
}

/**
 * Loads an x.com page in a hidden window on the signed-in X session and returns the GraphQL
 * results the page received, whether streamed into the HTML or fetched by the page itself.
 *
 * `ready` says when enough has arrived; without it the load runs to its timeout. `signal` (a
 * flow's Stop) ends the wait and closes the window, rejecting with the signal's reason.
 */
export async function readSignedInXPage(
  url: string,
  ready: (results: XGraphqlResult[]) => boolean,
  /** Which GraphQL operations to keep; the timeline and post queries unless a page needs others. */
  keep: RegExp = GRAPHQL_RE,
  signal?: AbortSignal,
): Promise<XCapturedPage> {
  return signedInGate.runExclusive(() => capture(url, ready, keep, signal));
}

async function capture(
  url: string,
  ready: (results: XGraphqlResult[]) => boolean,
  keep: RegExp,
  signal: AbortSignal | undefined,
): Promise<XCapturedPage> {
  // Stopped while another read held the gate: no window is opened at all.
  signal?.throwIfAborted();
  const win = new BrowserWindow({
    width: 1_280,
    height: 900,
    show: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    hiddenInMissionControl: process.platform === 'darwin',
    webPreferences: {
      session: siteSession('x'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      disableDialogs: true,
      ...SILENT_WEB_PREFERENCES,
    },
  });
  muteWindow(win);
  win.webContents.setUserAgent(CLEAN_UA);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const pending = new Map<string, Pending>();
  const results: XGraphqlResult[] = [];
  let status = 0;
  let documentSeen = false;
  const operations = new Set<string>();
  const dbg = win.webContents.debugger;

  try {
    // Mapped, not merely created: a window that has never been shown stalls rendering, and with
    // it the page's own fetches. Transparent before it is mapped, so it never flashes before parking.
    win.setOpacity(0);
    win.showInactive();
    parkWindowOffscreen(win);
    // A webContents that has never navigated gives the debugger no page, and `Network.enable`
    // then never answers; a blank page first gives it one.
    await within(win.loadURL('about:blank'), SETUP_TIMEOUT_MS, 'Opening the hidden X window');
    dbg.attach('1.3');
    // A POST names its query in the body, which only the request event carries.
    const posted = new Map<string, string>();
    dbg.on('message', (_event, method: string, params: Record<string, unknown>) => {
      if (method === 'Network.requestWillBeSent') {
        const request = params.request as { url: string; postData?: string };
        if (request.postData && keep.test(request.url)) posted.set(params.requestId as string, request.postData);
        return;
      }
      if (method === 'Network.responseReceived') {
        const response = params.response as { url: string; status: number };
        const type = params.type as string;
        const operation = ANY_GRAPHQL_RE.exec(response.url)?.[1];
        if (operation) operations.add(`${operation}:${response.status}`);
        const requestId = params.requestId as string;
        // The page itself: the first document, before any frame the page embeds.
        if (type === 'Document' && !documentSeen) {
          documentSeen = true;
          pending.set(requestId, { url: response.url, kind: 'document', status: response.status });
        } else if (keep.test(response.url)) {
          pending.set(requestId, { url: response.url, kind: 'graphql', status: response.status, postData: posted.get(requestId) });
        }
        return;
      }
      if (method !== 'Network.loadingFinished') return;
      const requestId = params.requestId as string;
      const entry = pending.get(requestId);
      if (!entry) return;
      pending.delete(requestId);
      void dbg.sendCommand('Network.getResponseBody', { requestId }).then((res: { body: string; base64Encoded: boolean }) => {
        const body = res.base64Encoded ? Buffer.from(res.body, 'base64').toString('utf8') : res.body;
        if (entry.kind === 'document') {
          status = entry.status;
          results.push(...readSsrGraphql(body));
          return;
        }
        const result = readGraphqlResponse(entry.url, body, entry.postData);
        if (result) results.push(result);
      }).catch(() => {});
    });
    await within(dbg.sendCommand('Network.enable'), SETUP_TIMEOUT_MS, 'Watching the hidden X window');
    signal?.throwIfAborted();
    void win.loadURL(url).catch(() => {});

    const started = Date.now();
    let readyAt = 0;
    while (Date.now() - started < LOAD_TIMEOUT_MS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      // The window closes in `finally` either way.
      signal?.throwIfAborted();
      if (win.isDestroyed()) break;
      if (!readyAt && ready(results)) readyAt = Date.now();
      if (readyAt && Date.now() - readyAt >= SETTLE_MS) break;
    }
    return { status, results: [...results], operations: [...operations] };
  } finally {
    try {
      if (dbg.isAttached()) dbg.detach();
    } catch {
    }
    if (!win.isDestroyed()) win.destroy();
  }
}
