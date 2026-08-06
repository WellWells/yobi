import { BrowserWindow, net } from 'electron';
import { TextDecoder } from 'node:util';
import { CLEAN_UA } from './userAgent';
import { SILENT_WEB_PREFERENCES, muteWindow } from './silentWindow';

const LOAD_TIMEOUT_MS = 25_000;

const RAW_FETCH_TIMEOUT_MS = 15_000;

const JS_SETTLE_MS = 1_500;

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
}

export function fetchRawText(url: string, options?: RawFetchOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Raw fetch timed out after ${RAW_FETCH_TIMEOUT_MS / 1_000}s`)),
      RAW_FETCH_TIMEOUT_MS,
    );

    const guard = options?.validateRedirectHost;
    const request = net.request({
      url: ensureHttpScheme(url),
      method: 'GET',
      redirect: guard ? 'manual' : 'follow',
    });
    for (const [name, value] of Object.entries(options?.headers ?? {})) request.setHeader(name, value);
    const chunks: Buffer[] = [];

    if (guard) {
      request.on('redirect', (_status, _method, redirectUrl) => {
        let host = '';
        try {
          host = new URL(redirectUrl).hostname.toLowerCase();
          guard(host);
        } catch (err) {
          clearTimeout(timer);
          request.abort();
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        request.followRedirect();
      });
    }

    request.on('response', (response) => {
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        clearTimeout(timer);
        resolve(decodeBody(Buffer.concat(chunks), headerValue(response.headers['content-type'])));
      });
      response.on('error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    request.on('error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });

    request.end();
  });
}

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
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

export async function loadPageHtml(url: string, validateRedirectHost?: (host: string) => void): Promise<string> {
  return (await loadPageResult(url, validateRedirectHost)).html;
}

export function loadPageResult(url: string, validateRedirectHost?: (host: string) => void): Promise<PageLoadResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

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

    win.webContents.setUserAgent(CLEAN_UA);
    muteWindow(win);

    if (validateRedirectHost) {
      const guardNavigation = (event: Electron.Event, targetUrl: string): void => {
        let host = '';
        try {
          host = new URL(targetUrl).hostname.toLowerCase();
          validateRedirectHost(host);
        } catch (err) {
          event.preventDefault();
          if (settled) return;
          settled = true;
          if (settleTimer) clearTimeout(settleTimer);
          clearTimeout(timeout);
          safeDestroy(win);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      };
      win.webContents.on('will-redirect', guardNavigation);
      win.webContents.on('will-navigate', guardNavigation);
    }

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (settleTimer) clearTimeout(settleTimer);
      safeDestroy(win);
      reject(new Error(`Page load timed out after ${LOAD_TIMEOUT_MS / 1_000}s`));
    }, LOAD_TIMEOUT_MS);

    win.webContents.on('did-finish-load', () => {
      if (settled) return;
      settleTimer = setTimeout(async () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try {
          let execTimer: ReturnType<typeof setTimeout> | undefined;
          const execTimeout = new Promise<never>((_, rej) => {
            execTimer = setTimeout(
              () => rej(new Error(`DOM serialization timed out after ${JS_EXEC_TIMEOUT_MS / 1_000}s`)),
              JS_EXEC_TIMEOUT_MS,
            );
          });
          const html = (await Promise.race([
            win.webContents.executeJavaScript('document.documentElement.innerHTML'),
            execTimeout,
          ]).finally(() => clearTimeout(execTimer))) as string;
          const finalUrl = win.webContents.getURL();
          safeDestroy(win);
          resolve({ html, finalUrl });
        } catch (err) {
          safeDestroy(win);
          reject(err);
        }
      }, JS_SETTLE_MS);
    });

    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (settled) return;
      if (!isMainFrame) return;
      if (errorCode === -3) return;
      settled = true;
      clearTimeout(timeout);
      if (settleTimer) clearTimeout(settleTimer);
      safeDestroy(win);
      reject(new Error(`Failed to load page: ${errorDescription} (${errorCode})`));
    });

    win.loadURL(url).catch((err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (settleTimer) clearTimeout(settleTimer);
      safeDestroy(win);
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
