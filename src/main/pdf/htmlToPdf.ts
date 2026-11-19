/**
 * Every PDF Yobi makes from a file is Chromium printing an HTML page: OfficeCLI's rendering of a
 * .docx/.xlsx/.pptx (it ships no PDF exporter), a user's own .html, or a page Yobi wraps around a
 * picture or text (`fileToPdf.ts`). No Word, no LibreOffice.
 *
 * The page is the user's document, so the window reaches nothing: every request but files in the
 * page's own folder and data: URLs is cancelled (OfficeCLI's page asks a font CDN for any family
 * the system lacks), popups are denied and navigation is stopped. Its own scripts run: they lay
 * out the pages.
 */
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, session } from 'electron';
import { SILENT_WEB_PREFERENCES, muteWindow, hideBeforeMapping, parkWindowOffscreen } from '../silentWindow';

const PDF_PARTITION = 'pdf-print';
const PDF_TIMEOUT_MS = 60_000;
/**
 * After load: two frames plus a beat for the page's own layout script — or a second, whichever
 * comes first. A parked window gets no frames while the display is off (measured:
 * requestAnimationFrame never fired, printToPDF still printed in 81 ms), which is exactly when a
 * bot asks from a phone; waiting on frames alone timed every PDF out.
 */
export const SETTLE_SCRIPT = `new Promise((resolve) => {
  let settled = false;
  const settle = () => { if (!settled) { settled = true; setTimeout(resolve, 300); } };
  requestAnimationFrame(() => requestAnimationFrame(settle));
  setTimeout(settle, 1000);
})`;

/** file: URL prefixes (each render's own private temp folder) a page may load from. */
const allowedFolders = new Set<string>();
let guardInstalled = false;

/** True for the only URLs a rendering page may load: files in its own temp folder and inline data. */
export function isAllowedPdfRequest(url: string, folders: ReadonlySet<string>): boolean {
  if (url.startsWith('data:')) return true;
  return [...folders].some((folder) => url.startsWith(folder));
}

function installGuard(): void {
  if (guardInstalled) return;
  guardInstalled = true;
  const ses = session.fromPartition(PDF_PARTITION);
  ses.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedPdfRequest(details.url, allowedFolders) });
  });
  ses.on('will-download', (event) => event.preventDefault());
}

/** Prints an HTML file to PDF bytes in a hidden, offline window; it may load files beside it only. */
export async function printHtmlFileToPdf(htmlFile: string, signal?: AbortSignal): Promise<Buffer> {
  if (signal?.aborted) throw new Error('PDF rendering stopped');
  installGuard();
  const url = pathToFileURL(htmlFile).href;
  const folder = pathToFileURL(`${path.dirname(htmlFile)}${path.sep}`).href;
  allowedFolders.add(folder);
  const win = new BrowserWindow({
    show: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    hiddenInMissionControl: process.platform === 'darwin',
    width: 1000,
    height: 1400,
    webPreferences: {
      partition: PDF_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      ...SILENT_WEB_PREFERENCES,
    },
  });
  muteWindow(win);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  // A never-shown window stalls rendering: map it invisibly, as the export capture does.
  hideBeforeMapping(win);
  win.showInactive();
  parkWindowOffscreen(win);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const stop = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`PDF rendering timed out after ${PDF_TIMEOUT_MS / 1_000}s`)), PDF_TIMEOUT_MS);
    onAbort = () => reject(new Error('PDF rendering stopped'));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const render = (async () => {
      await win.loadURL(url);
      await win.webContents.executeJavaScript(SETTLE_SCRIPT, true);
      return Buffer.from(await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, pageSize: 'A4' }));
    })();
    // Losing the race to a timeout or stop, the render still settles (the window is destroyed).
    render.catch(() => undefined);
    return await Promise.race([render, stop]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    allowedFolders.delete(folder);
    if (!win.isDestroyed()) win.destroy();
  }
}
