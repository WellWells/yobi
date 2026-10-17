import { BrowserWindow } from 'electron';
import { SILENT_WEB_PREFERENCES, muteWindow, parkWindowOffscreen } from '../silentWindow';
import { prepareSiteWindow, siteSession } from '../siteAccounts';
import { Semaphore } from '../flow/lanes';
import { within } from '../promiseRace';
import { scriptJson } from '../flow/skills/jsonPick';

/*
 * An Instagram page read the way a person reads it: opened signed in, in a hidden window with the
 * sign-in window's Chrome identity, reading the data the page's own scripts receive rather than
 * making those requests itself.
 */

const LOAD_TIMEOUT_MS = 30_000;
const SETUP_TIMEOUT_MS = 10_000;
/** How long to keep collecting after `ready` first holds, for the rest of the page's answers. */
const SETTLE_MS = 1_200;
const POLL_MS = 250;

/** The page's own data requests: GraphQL and the web API. */
const DATA_URL = /^https:\/\/www\.instagram\.com\/(?:graphql\/query|api\/graphql|api\/v1\/)/;
/** The key a profile's posts connection answers under. */
export const TIMELINE_KEY = 'xdt_api__v1__feed__user_timeline_graphql_connection';

/** One signed-in Instagram page at a time: each is a view on the user's own account. */
const gate = new Semaphore(1);

export interface CapturedPage {
  status: number;
  /** The page's HTML. */
  html: string;
  /** The page's own JSON (its `data-sjs` blocks), then every JSON answer of its data requests. */
  answers: unknown[];
  /** The data requests the page made (`name:status`): what to look at when Instagram renames one. */
  operations: string[];
}

/** A data request's name: GraphQL's friendly name where the request gives one, else its path. */
function operationName(url: string, headers: Record<string, string>, postData: string | undefined): string {
  const friendly = headers['X-FB-Friendly-Name'] ?? headers['x-fb-friendly-name']
    ?? /(?:^|&)fb_api_req_friendly_name=([^&]+)/.exec(postData ?? '')?.[1];
  if (friendly) return decodeURIComponent(friendly);
  return new URL(url).pathname.replace(/\/\d{5,}\//g, '/<id>/');
}

/** A response body's JSON: GraphQL may stream several documents, one per line. */
function parseAnswers(body: string): unknown[] {
  const text = body.replace(/^for \(;;\);/, '');
  try {
    return [JSON.parse(text) as unknown];
  } catch {
    const out: unknown[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim().startsWith('{')) continue;
      try {
        out.push(JSON.parse(line) as unknown);
      } catch {
        // Not JSON: nothing to read.
      }
    }
    return out;
  }
}

/**
 * Opens `url` (an instagram.com page) signed in and returns the page and the JSON it held and
 * received, once `ready` holds for them (or the load gives up). `signal` (a flow's Stop) closes the
 * window and rejects with its reason.
 */
export function readSignedInPage(url: string, ready: (answers: readonly unknown[]) => boolean, signal?: AbortSignal): Promise<CapturedPage> {
  return gate.runExclusive(() => capture(url, ready, signal));
}

/** An account's profile, once the page's script has its posts (`TIMELINE_KEY`). */
export function readSignedInProfile(author: string, signal?: AbortSignal): Promise<CapturedPage> {
  const hasTimeline = (answers: readonly unknown[]): boolean => answers.some((a) => JSON.stringify(a).includes(TIMELINE_KEY));
  return readSignedInPage(`https://www.instagram.com/${author}/`, hasTimeline, signal);
}

async function capture(url: string, ready: (answers: readonly unknown[]) => boolean, signal: AbortSignal | undefined): Promise<CapturedPage> {
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
      session: siteSession('instagram'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      disableDialogs: true,
      ...SILENT_WEB_PREFERENCES,
    },
  });
  muteWindow(win);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const dbg = win.webContents.debugger;
  const pageAnswers: unknown[] = [];
  const answers: unknown[] = [];
  const operations: string[] = [];
  const pending = new Map<string, { kind: 'document' | 'data'; status: number }>();
  const names = new Map<string, string>();
  let html = '';
  let status = 0;
  let documentSeen = false;
  let changed = false;

  try {
    // Mapped, not merely created: a window never shown stalls the page's own scripts.
    // Transparent before it is mapped, so it never flashes before parking.
    win.setOpacity(0);
    win.showInactive();
    parkWindowOffscreen(win);
    // A webContents that never navigated gives the debugger no page: a blank one first.
    await within(win.loadURL('about:blank'), SETUP_TIMEOUT_MS, 'Opening the hidden Instagram window');
    // The sign-in window's identity (it attaches the debugger for its override).
    await prepareSiteWindow(win.webContents, 'Instagram');
    if (!dbg.isAttached()) dbg.attach('1.3');
    dbg.on('message', (_event, method: string, params: Record<string, unknown>) => {
      if (method === 'Network.requestWillBeSent') {
        const request = params.request as { url: string; headers?: Record<string, string>; postData?: string };
        if (DATA_URL.test(request.url)) names.set(params.requestId as string, operationName(request.url, request.headers ?? {}, request.postData));
        return;
      }
      if (method === 'Network.responseReceived') {
        const response = params.response as { url: string; status: number };
        const requestId = params.requestId as string;
        if (params.type === 'Document' && !documentSeen) {
          documentSeen = true;
          pending.set(requestId, { kind: 'document', status: response.status });
        } else if (DATA_URL.test(response.url)) {
          operations.push(`${names.get(requestId) ?? new URL(response.url).pathname}:${response.status}`);
          pending.set(requestId, { kind: 'data', status: response.status });
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
          html = body;
          pageAnswers.push(...scriptJson(body, { sjsOnly: true }));
        } else {
          answers.push(...parseAnswers(body));
        }
        changed = true;
      }).catch(() => {});
    });
    await within(dbg.sendCommand('Network.enable'), SETUP_TIMEOUT_MS, 'Watching the hidden Instagram window');
    signal?.throwIfAborted();
    void win.loadURL(url).catch(() => {});

    const started = Date.now();
    let readyAt = 0;
    while (Date.now() - started < LOAD_TIMEOUT_MS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      signal?.throwIfAborted();
      if (win.isDestroyed()) break;
      if (!readyAt && html && changed) {
        changed = false;
        if (ready([...pageAnswers, ...answers])) readyAt = Date.now();
      }
      if (readyAt && Date.now() - readyAt >= SETTLE_MS) break;
    }
    const landed = win.isDestroyed() ? '' : win.webContents.getURL();
    if (landed && landed !== url) operations.unshift(`landed on ${landed}`);
    return { status, html, answers: [...pageAnswers, ...answers], operations };
  } finally {
    try {
      if (dbg.isAttached()) dbg.detach();
    } catch {
      // Already gone with the window.
    }
    if (!win.isDestroyed()) win.destroy();
  }
}
