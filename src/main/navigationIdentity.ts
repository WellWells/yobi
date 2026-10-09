import { app } from 'electron';
import type { DidCreateWindowDetails, LoadURLOptions, Session, WebContents } from 'electron';
import { GOOGLE_UA, documentUserAgent } from './userAgent';

type Navigable = Pick<WebContents, 'getUserAgent' | 'setUserAgent' | 'getURL' | 'loadURL' | 'isDestroyed' | 'on'>;

const followingSessions = new WeakSet<Session>();
const fixedIdentity = new WeakSet<object>();
const bodyKeepingRedirects = new WeakSet<object>();
const replacements = new WeakMap<object, Promise<void>>();
let listening = false;

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export function keepsRequestBody(statusCode: number, method: string): boolean {
  return (statusCode === 307 || statusCode === 308) && method !== 'GET' && method !== 'HEAD';
}

export function followDestinationIdentity(ses: Session): void {
  if (!GOOGLE_UA) return;
  followingSessions.add(ses);
  ses.webRequest.onHeadersReceived({ urls: ['<all_urls>'], types: ['mainFrame'] }, (details, callback) => {
    if (details.webContents) noteRedirectKind(details.webContents, keepsRequestBody(details.statusCode, details.method));
    callback({});
  });
  if (listening) return;
  listening = true;
  const googleUserAgent = GOOGLE_UA;
  app.on('web-contents-created', (_event, wc) => {
    if (followingSessions.has(wc.session)) followNavigations(wc, googleUserAgent);
  });
}

export function noteRedirectKind(wc: object, keepsBody: boolean): void {
  if (keepsBody) bodyKeepingRedirects.add(wc);
  else bodyKeepingRedirects.delete(wc);
}

export function windowFollowsIdentity(wc: WebContents): boolean {
  return followingSessions.has(wc.session) && !fixedIdentity.has(wc);
}

export function followNavigations(wc: Navigable, googleUserAgent: string): void {
  wc.on('did-start-navigation', (details) => {
    if (!details.isMainFrame || details.isSameDocument || fixedIdentity.has(wc)) return;
    const current = wc.getUserAgent();
    const next = documentUserAgent(current, details.url, googleUserAgent);
    if (next !== current) wc.setUserAgent(next);
  });

  wc.on('will-redirect', (details) => {
    if (!details.isMainFrame || fixedIdentity.has(wc) || !isHttpUrl(details.url)) return;
    if (bodyKeepingRedirects.has(wc)) return;
    const current = wc.getUserAgent();
    if (documentUserAgent(current, details.url, googleUserAgent) === current) return;
    details.preventDefault();
    replaceNavigation(wc, details.url);
  });

  wc.on('did-create-window', (popup, details) => {
    adoptPopup(popup.webContents, details, googleUserAgent);
  });
}

function replaceNavigation(wc: Navigable, url: string): void {
  const from = wc.getURL();
  const options: LoadURLOptions = isHttpUrl(from)
    ? { httpReferrer: { url: from, policy: 'strict-origin-when-cross-origin' } }
    : {};
  const replacement = new Promise<void>((resolve, reject) => {
    setImmediate(() => {
      if (wc.isDestroyed()) {
        reject(new Error('The window closed before the redirect could be followed'));
        return;
      }
      wc.loadURL(url, options).then(resolve, reject);
    });
  });
  replacement.catch(() => {});
  replacements.set(wc, replacement);
}

function adoptPopup(popup: Navigable, details: DidCreateWindowDetails, googleUserAgent: string): void {
  if (!isHttpUrl(details.url) || details.postBody) {
    fixedIdentity.add(popup);
    return;
  }
  const userAgent = documentUserAgent(popup.getUserAgent(), details.url, googleUserAgent);
  void popup.loadURL(details.url, { userAgent, httpReferrer: details.referrer }).catch(() => {});
}

export async function loadURLFollowingIdentity(wc: Navigable, url: string): Promise<void> {
  const before = replacements.get(wc);
  try {
    await wc.loadURL(url);
    return;
  } catch (err) {
    let replacement = replacements.get(wc);
    if (!replacement || replacement === before) throw err;
    for (;;) {
      try {
        await replacement;
        return;
      } catch (next) {
        const chained = replacements.get(wc);
        if (!chained || chained === replacement) throw next;
        replacement = chained;
      }
    }
  }
}
