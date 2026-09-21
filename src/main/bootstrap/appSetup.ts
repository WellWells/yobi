import { app, nativeImage } from 'electron';
import { config } from '../config';
import {
  sendLog,
  sendToRenderer,
  setMainWindow,
  setNotifyEnabled,
  setWorkerReveal,
  getAssetPath,
} from '../helpers';
import { loadLanguageData, setLangCache, setEnCache } from '../i18n';
import {
  createMainWindow,
  createWorkerWindow,
  getMainWin,
  getWorkerWin,
  revealWorkerWindow,
} from '../windows';
import { initializeUpdater } from '../updater';

export function setupPlatformIcons(): void {
  if (process.platform !== 'darwin') return;
  const dockIcon = nativeImage.createFromPath(getAssetPath('icon-mac.png'));
  app.dock?.setIcon(dockIcon);
  app.setAboutPanelOptions({
    applicationName: 'Yobi',
    iconPath: getAssetPath('icon-mac.png'),
  });
}

export async function loadInitialLanguages(): Promise<void> {
  const initialLang = await loadLanguageData(config.locale);
  if (initialLang) setLangCache(initialLang);
  const enLang = await loadLanguageData('en-US');
  if (enLang) setEnCache(enLang);
}

/** Longest the worker warm-up waits on the main window before starting anyway. */
const WORKER_WARMUP_FALLBACK_MS = 5_000;

export function setupWindows(): void {
  createMainWindow();
  const mainWin = getMainWin();
  setMainWindow(mainWin);
  setWorkerReveal(() => {
    revealWorkerWindow();
  });
  setNotifyEnabled(config.notifyOnComplete);
  initializeUpdater({ sendLog, sendToRenderer });

  warmWorkerWindowAfterMainWindow(mainWin);
}

/**
 * The worker holds a whole provider SPA in a second renderer. Booting it in the
 * same breath as the main window put megabytes of someone else's JS, and its
 * network, in front of our own first paint. Warming it once the main window has
 * finished loading keeps the head start the first ask depends on — and every
 * on-demand path already goes through `ensureWorkerWindow`, so a slow or failed
 * main window only costs the head start, never the feature.
 */
// Exported for the test suite.
export function warmWorkerWindowAfterMainWindow(mainWin: Electron.BrowserWindow | null): void {
  let started = false;
  const start = (): void => {
    if (started) return;
    started = true;
    // A bot backlog message or a flow due at boot can beat the warm-up to it, and
    // createWorkerWindow destroys whatever is already there — killing a task mid-run. The
    // head start is worth nothing if it costs the first real request.
    if (getWorkerWin()) return;
    createWorkerWindow(config.targetUrl);
  };

  if (!mainWin || mainWin.isDestroyed()) {
    start();
    return;
  }
  mainWin.webContents.once('did-finish-load', start);
  setTimeout(start, WORKER_WARMUP_FALLBACK_MS).unref?.();
}
