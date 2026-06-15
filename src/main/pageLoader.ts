import { BrowserWindow, net } from 'electron';
import { CLEAN_UA } from './userAgent';

const LOAD_TIMEOUT_MS = 25_000;

const RAW_FETCH_TIMEOUT_MS = 15_000;

const JS_SETTLE_MS = 1_500;

const JS_EXEC_TIMEOUT_MS = 10_000;
const URL_PARSER_PARTITION = 'persist:url-parser';

export function fetchRawText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Raw fetch timed out after ${RAW_FETCH_TIMEOUT_MS / 1_000}s`)),
      RAW_FETCH_TIMEOUT_MS,
    );

    const request = net.request({ url, method: 'GET' });
    const chunks: Buffer[] = [];

    request.on('response', (response) => {
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        clearTimeout(timer);
        resolve(Buffer.concat(chunks).toString('utf8'));
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

export function loadPageHtml(url: string): Promise<string> {
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
      },
    });

    win.webContents.setUserAgent(CLEAN_UA);

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
          safeDestroy(win);
          resolve(html);
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
