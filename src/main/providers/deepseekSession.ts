/**
 * DeepSeek keeps its sign-in in the page's localStorage (`userToken`, sent as a Bearer token), not
 * in a cookie: the only cookies on chat.deepseek.com are the WAF's and a session id every visitor
 * gets. So the account check reads that origin's localStorage — from a page
 * already open there when there is one, otherwise from a hidden window on a static same-origin URL
 * that runs no DeepSeek script.
 */
import { BrowserWindow, webContents } from 'electron';
import type { Session, WebContents } from 'electron';
import { userAgentForUrl } from '../userAgent';
import { SILENT_WEB_PREFERENCES, muteWindow } from '../silentWindow';

export const DEEPSEEK_LOGIN_REQUIRED = 'DEEPSEEK_LOGIN_REQUIRED';
export const DEEPSEEK_ORIGIN = 'https://chat.deepseek.com';
export const DEEPSEEK_SIGN_IN_URL = `${DEEPSEEK_ORIGIN}/sign_in`;

/** A CloudFront 403 page today; any response from the origin gives its localStorage. */
const PROBE_URL = `${DEEPSEEK_ORIGIN}/robots.txt`;
const PROBE_TIMEOUT_MS = 15_000;
/** A probed answer is kept this long; a page on the origin is always read fresh. */
const PROBE_TTL_MS = 10 * 60_000;

/** Evaluated on chat.deepseek.com: true while the page holds a sign-in token. */
export const DEEPSEEK_TOKEN_PROBE_JS = `(function () {
  try {
    var stored = JSON.parse(localStorage.getItem('userToken') || 'null');
    return !!(stored && typeof stored.value === 'string' && stored.value.length > 0);
  } catch (e) {
    return false;
  }
})()`;

/** The sign-in and sign-up pages: where a signed-out visitor is sent. */
export function isDeepseekSignedOutPath(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === DEEPSEEK_ORIGIN && /^\/(sign_in|sign_up|login)(\/|$)/.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function isDeepseekLoginRequiredError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return msg.includes(DEEPSEEK_LOGIN_REQUIRED);
}

function isOnDeepseek(url: string): boolean {
  try {
    return new URL(url).origin === DEEPSEEK_ORIGIN;
  } catch {
    return false;
  }
}

let probed: { signedIn: boolean; at: number } | null = null;
let probing: Promise<boolean> | null = null;

/** Forget the last answer: the session was cleared, or a send just learned the truth. */
export function noteDeepseekSignedIn(signedIn: boolean | null): void {
  probed = signedIn === null ? null : { signedIn, at: Date.now() };
}

export async function readDeepseekTokenIn(contents: WebContents): Promise<boolean> {
  return (await contents.executeJavaScript(DEEPSEEK_TOKEN_PROBE_JS, false)) === true;
}

function openPage(ses: Session): WebContents | null {
  const all = typeof webContents?.getAllWebContents === 'function' ? webContents.getAllWebContents() : [];
  return all.find((contents) => (
    !contents.isDestroyed() && contents.session === ses && !contents.isLoading() && isOnDeepseek(contents.getURL())
  )) ?? null;
}

async function probeInHiddenWindow(ses: Session): Promise<boolean> {
  const win = new BrowserWindow({
    show: false,
    focusable: false,
    webPreferences: { ...SILENT_WEB_PREFERENCES, session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  muteWindow(win);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    await Promise.race([
      win.loadURL(PROBE_URL, { userAgent: userAgentForUrl(PROBE_URL) }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('DeepSeek sign-in probe timed out')), PROBE_TIMEOUT_MS)),
    ]);
    if (!isOnDeepseek(win.webContents.getURL())) return false;
    return await readDeepseekTokenIn(win.webContents);
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

/** Whether the worker's session holds a DeepSeek sign-in; an unreadable store counts as signed out. */
export async function isDeepseekSignedIn(ses: Session): Promise<boolean> {
  const page = openPage(ses);
  if (page) {
    try {
      const signedIn = await readDeepseekTokenIn(page);
      noteDeepseekSignedIn(signedIn);
      return signedIn;
    } catch {
      // The page navigated away mid-read; fall through to the probe.
    }
  }
  if (probed && Date.now() - probed.at < PROBE_TTL_MS) return probed.signedIn;
  probing ??= probeInHiddenWindow(ses)
    .then((signedIn) => {
      noteDeepseekSignedIn(signedIn);
      return signedIn;
    })
    .catch(() => false)
    .finally(() => { probing = null; });
  return probing;
}
