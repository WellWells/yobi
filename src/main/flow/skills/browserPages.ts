import { BrowserWindow } from 'electron';
import type { WebContents } from 'electron';
import * as path from 'node:path';
import { createEntityId } from '../flowPersistence';
import { CLEAN_UA } from '../../userAgent';
import { executeAutomationWithTimeout } from '../../providers/automationExecutor';
import { BROWSER_HELPER_PREAMBLE } from '../../providers/browserHelpers';

export const BROWSER_FLOW_PARTITION = 'persist:browser-flow';

const MAX_OPEN_PAGES = 12;

const OPEN_LOAD_TIMEOUT_MS = 25_000;

interface PageEntry {
  win: BrowserWindow;
  flowId: string;
}

const pages = new Map<string, PageEntry>();

export interface OpenPageOptions {
  show?: boolean;
  flowId: string;
}

export interface OpenPageResult {
  id: string;
  title: string;
  url: string;
}

function safeDestroy(win: BrowserWindow): void {
  try {
    if (!win.isDestroyed()) win.destroy();
  } catch {
  }
}

function revealPage(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  win.setBounds({ x: 100, y: 100, width: 1_280, height: 900 });
  if (process.platform !== 'darwin') win.setSkipTaskbar(false);
  win.setOpacity(1);
  win.show();
  win.focus();
}

function assertHttpUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`browser_open: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`browser_open: only http(s) URLs are allowed (got ${parsed.protocol})`);
  }
}

export function isManagedPageWebContents(wc: WebContents): boolean {
  for (const entry of pages.values()) {
    if (!entry.win.isDestroyed() && entry.win.webContents === wc) return true;
  }
  return false;
}

export async function openPage(url: string, opts: OpenPageOptions): Promise<OpenPageResult> {
  if (pages.size >= MAX_OPEN_PAGES) {
    throw new Error(`browser_open: too many open pages (max ${MAX_OPEN_PAGES}). Close pages with browser_close.`);
  }
  assertHttpUrl(url);

  const preloadPath = path.join(__dirname, '../preload/browserPage.js');
  const win = new BrowserWindow({
    x: -20_000,
    y: -20_000,
    width: 1_280,
    height: 900,
    show: false,
    skipTaskbar: true,
    focusable: opts.show === true,
    webPreferences: {
      partition: BROWSER_FLOW_PARTITION,
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  win.webContents.setUserAgent(CLEAN_UA);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, navUrl) => {
    if (!/^https?:\/\//i.test(navUrl) && !navUrl.startsWith('about:')) e.preventDefault();
  });

  const id = `page-${createEntityId()}`;
  pages.set(id, { win, flowId: opts.flowId });
  win.on('closed', () => { pages.delete(id); });

  await new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve();
    };
    win.webContents.once('did-finish-load', finish);
    win.webContents.once('did-fail-load', (_e, code, _desc, _u, isMainFrame) => {
      if (isMainFrame && code !== -3) finish();
    });
    win.loadURL(url).catch(() => finish());
    setTimeout(finish, OPEN_LOAD_TIMEOUT_MS);
  });

  if (opts.show === true) revealPage(win);

  const wc = win.webContents;
  return {
    id,
    title: wc.isDestroyed() ? '' : wc.getTitle(),
    url: wc.isDestroyed() ? url : (wc.getURL() || url),
  };
}

function getPage(id: string): BrowserWindow | undefined {
  const entry = pages.get(id);
  if (!entry) return undefined;
  if (entry.win.isDestroyed()) {
    pages.delete(id);
    return undefined;
  }
  return entry.win;
}

export async function runPageScript(id: string, code: string, timeoutMs: number): Promise<string> {
  const win = getPage(id);
  if (!win) throw new Error(`browser_js: page handle "${id}" is not open`);

  const script =
    BROWSER_HELPER_PREAMBLE + '\n' +
    '(async function __browserJsStep(){\n' + code + '\n})()' +
    '.then(function(v){' +
    'if (v === undefined || v === null) return "";' +
    'if (typeof v === "object") { try { return JSON.stringify(v); } catch (e) { return String(v); } }' +
    'return String(v);' +
    '})';

  const result = await executeAutomationWithTimeout<string>(win.webContents, script, timeoutMs, 'browser.js');
  return typeof result === 'string' ? result : String(result ?? '');
}

export function navigatePageBlank(id: string): void {
  const win = getPage(id);
  if (win) {
    win.webContents.loadURL('about:blank').catch(() => { });
  }
}

export function closePage(id: string): boolean {
  const entry = pages.get(id);
  if (!entry) return false;
  pages.delete(id);
  safeDestroy(entry.win);
  return true;
}

export function closeRunPages(flowId: string): void {
  for (const [id, entry] of [...pages.entries()]) {
    if (entry.flowId === flowId) {
      pages.delete(id);
      safeDestroy(entry.win);
    }
  }
}
