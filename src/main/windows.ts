import { app, BrowserWindow, nativeImage, nativeTheme, shell } from 'electron';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { sendLog, sendWebNotification, getAssetPath, setWorkerAttention } from './helpers';
import { toggleTempChatMode } from './tempChat';
import { getLangCache, t } from './i18n';
import { CLEAN_UA } from './userAgent';
import { applyWorkerUserAgent } from './clientHints';
import { PROVIDER_URLS, isByokTargetUrl } from '../shared/types';
import { themeBackground } from '../shared/themes';
import { config } from './config';

const WORKER_PARTITION = 'persist:gemini';
type WorkerWindowMode = 'automation' | 'interactive';

function getWindowIcon(): Electron.NativeImage {
  if (process.platform === 'darwin') {
    return nativeImage.createFromPath(getAssetPath('icon-mac.png'));
  }
  const icoPath = getAssetPath('icon-win.ico');
  if (existsSync(icoPath)) {
    return nativeImage.createFromPath(icoPath);
  }
  return nativeImage.createFromPath(getAssetPath('icon-win.png'));
}

let mainWin: BrowserWindow | null = null;
let workerWin: BrowserWindow | null = null;
let workerVisibleBounds: Electron.Rectangle | null = null;
let workerWindowMode: WorkerWindowMode | null = null;
let isAppQuitting = false;

type MainWinCloseHandler = (event: Electron.Event) => void;
let _mainWinCloseHandler: MainWinCloseHandler | null = null;

export function setMainWindowCloseHandler(handler: MainWinCloseHandler): void {
  _mainWinCloseHandler = handler;
}

export function getMainWin(): BrowserWindow | null {
  return mainWin;
}

export function getWorkerWin(): BrowserWindow | null {
  return workerWin;
}

export function setAppQuitting(value: boolean): void {
  isAppQuitting = value;
}

export function isAllWindowsClosed(): boolean {
  return (mainWin === null || mainWin.isDestroyed()) &&
    (workerWin === null || workerWin.isDestroyed());
}

export function createMainWindow(): void {
  const isDev = !app.isPackaged;
  const preloadPath = path.join(__dirname, '../preload/index.js');

  mainWin = new BrowserWindow({
    width: 1_100,
    height: 700,
    minWidth: 700,
    minHeight: 500,
    title: 'Yobi',
    frame: false,
    // Match the configured theme so light-theme users don't get a dark flash
    // at startup and during resize.
    backgroundColor: themeBackground(config.theme, nativeTheme.shouldUseDarkColors),
    icon: getWindowIcon(),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  if (isDev) {
    mainWin.webContents.openDevTools({ mode: 'detach' });
  }

  if (isDev) {
    mainWin.loadURL(process.env['ELECTRON_RENDERER_URL'] as string);
  } else {
    mainWin.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWin.setMenuBarVisibility(false);

  // The main window only ever hosts the local app bundle, which carries the full
  // electronAPI bridge. Block any attempt to navigate the top-level frame or open
  // a child window elsewhere: a stray remote/AI-authored link that slipped past
  // the in-app external-link handling would otherwise load a remote origin with
  // the bridge attached. Defer real http(s) targets to the OS browser.
  mainWin.webContents.on('will-navigate', (event, url) => {
    if (url === mainWin?.webContents.getURL()) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Ctrl+Shift+I (⌘+Shift+I on macOS) toggles temporary chat mode whenever the
  // app window is focused. Intercepted here rather than in the renderer:
  // preventDefault() also swallows Electron's default-menu DevTools accelerator
  // bound to the same combo on Windows/Linux.
  mainWin.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return;
    const modifier = process.platform === 'darwin' ? input.meta : input.control;
    // Physical-key code keeps the shortcut working on non-Latin keyboard layouts.
    if (modifier && input.shift && !input.alt && input.code === 'KeyI') {
      event.preventDefault();
      toggleTempChatMode();
    }
  });

  mainWin.on('close', (event) => {
    if (isAppQuitting) return;
    if (_mainWinCloseHandler) {
      _mainWinCloseHandler(event);
      return;
    }
    if (process.platform !== 'darwin') {
      event.preventDefault();
      void app.quit();
    }
  });

  mainWin.on('closed', () => { mainWin = null; });
}

function destroyWorkerWindowForModeSwitch(): void {
  if (!workerWin || workerWin.isDestroyed()) return;
  const previousWorkerWin = workerWin;
  previousWorkerWin.removeAllListeners('close');
  previousWorkerWin.removeAllListeners('closed');
  previousWorkerWin.destroy();
  workerWin = null;
  workerWindowMode = null;
}

export function createWorkerWindow(initialUrl: string, mode: WorkerWindowMode = 'automation'): void {
  // BYOK targets are HTTP API endpoints, not loadable pages; boot the worker on
  // the default provider so browser automations passing their own URL still work.
  const bootUrl = isByokTargetUrl(initialUrl) ? PROVIDER_URLS.gemini : initialUrl;
  destroyWorkerWindowForModeSwitch();
  const workerPreload = path.join(__dirname, '../preload/worker.js');
  const webPreferences = mode === 'automation'
    ? {
        partition: WORKER_PARTITION,
        contextIsolation: false,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
        preload: workerPreload,
      }
    : {
        partition: WORKER_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      };

  workerWin = new BrowserWindow({
    width: 1_280,
    height: 900,
    show: false,
    frame: true,
    autoHideMenuBar: true,
    skipTaskbar: true,
    hiddenInMissionControl: process.platform === 'darwin',
    focusable: true,
    hasShadow: false,
    title: 'Provider Worker',
    webPreferences,
  });
  workerWindowMode = mode;

  workerWin.setMenuBarVisibility(false);

  workerWin.setOpacity(0);
  workerWin.setPosition(-10_000, -10_000);
  workerWin.showInactive();

  workerWin.on('move', () => rememberWorkerVisibleBounds());
  workerWin.on('resize', () => rememberWorkerVisibleBounds());

  applyWorkerUserAgent(workerWin.webContents, CLEAN_UA);
  workerWin.loadURL(bootUrl);

  workerWin.on('close', (event) => {
    if (isAppQuitting) return;
    event.preventDefault();
    hideWorkerWindow();
  });
  workerWin.on('closed', () => {
    workerWin = null;
    workerWindowMode = null;
  });
}

export function revealWorkerWindow(): void {
  if (!workerWin || workerWin.isDestroyed()) return;
  if (workerVisibleBounds) {
    workerWin.setBounds(workerVisibleBounds);
  } else {
    workerWin.setPosition(100, 100);
  }
  if (process.platform !== 'darwin') {
    workerWin.setSkipTaskbar(false);
  }
  workerWin.setOpacity(1);
  workerWin.show();
  workerWin.focus();
  if (!app.isPackaged) workerWin.webContents.openDevTools({ mode: 'detach' });
  rememberWorkerVisibleBounds();
  setWorkerAttention('idle');
}

export function hideWorkerWindow(): void {
  if (!workerWin || workerWin.isDestroyed()) return;
  rememberWorkerVisibleBounds();
  workerWin.setSkipTaskbar(true);
  if (workerWin.isVisible()) {
    workerWin.setOpacity(0);
    workerWin.setPosition(-10_000, -10_000);
  }
}

function rememberWorkerVisibleBounds(): void {
  if (!workerWin || workerWin.isDestroyed()) return;
  if (!workerWin.isVisible()) return;
  if (workerWin.getOpacity() < 0.99) return;
  const [x, y] = workerWin.getPosition();
  if (x <= -9_000 || y <= -9_000) return;
  workerVisibleBounds = workerWin.getBounds();
}

// Decide whether a live worker whose mode differs from `desired` should be torn
// down and recreated. Only consulted when the modes actually differ.
function shouldSwitchWorkerMode(desired: WorkerWindowMode): boolean {
  // A login / Cloudflare challenge always needs the interactive window now.
  if (desired === 'interactive') return true;
  // desired === 'automation': the worker is currently interactive. If it is still
  // visible the user is mid-login — the page is genuinely on-screen, so automation
  // works without the hidden-visibility preload; don't yank the window away.
  // Reclaim it for automation only once it has been hidden again (the degraded
  // state the automation preload exists to fix). Without this, a single login /
  // Cloudflare reveal would leave EVERY later automation running in the interactive
  // window until app restart.
  if (!workerWin || workerWin.isDestroyed()) return true;
  return !workerWin.isVisible();
}

export async function ensureWorkerWindow(
  initialUrl: string,
  mode: WorkerWindowMode = 'automation',
): Promise<BrowserWindow | null> {
  const needsRecreate =
    !workerWin ||
    workerWin.isDestroyed() ||
    (workerWindowMode !== mode && shouldSwitchWorkerMode(mode));
  if (needsRecreate) {
    createWorkerWindow(initialUrl, mode);
    await new Promise((r) => setTimeout(r, 1_200));
  }
  if (!workerWin || workerWin.isDestroyed()) return null;
  return workerWin;
}

export async function showInteractiveWorkerWindow(targetUrl: string): Promise<BrowserWindow | null> {
  const win = await ensureWorkerWindow(targetUrl, 'interactive');
  if (!win) return null;
  const currentUrl = win.webContents.getURL();
  if (currentUrl && currentUrl !== targetUrl) {
    await win.loadURL(targetUrl);
  }
  revealWorkerWindow();
  return win;
}

export async function showLoginWindowIfNeeded(providerLabel: string, targetUrl: string): Promise<void> {
  const win = await showInteractiveWorkerWindow(targetUrl);
  if (!win) return;
  setWorkerAttention('login');
  sendLog(`🔐 ${providerLabel} requires login — complete sign-in in the opened window`);
  const strings = getLangCache();
  sendWebNotification(
    t(strings, 'login.notify.title', { provider: providerLabel }),
    t(strings, 'login.notify.body'),
    'warning',
  );
}
