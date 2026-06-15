import { app, BrowserWindow, nativeImage } from 'electron';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { sendLog, sendWebNotification, getAssetPath, setWorkerAttention } from './helpers';
import { getLangCache, t } from './i18n';
import { CLEAN_UA } from './userAgent';
import { applyWorkerUserAgent } from './clientHints';

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
    backgroundColor: '#0d1117',
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
  workerWin.loadURL(initialUrl);

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

export async function ensureWorkerWindow(
  initialUrl: string,
  mode?: WorkerWindowMode,
): Promise<BrowserWindow | null> {
  const desiredMode = mode ?? 'automation';
  if (!workerWin || workerWin.isDestroyed() || (mode && workerWindowMode !== desiredMode)) {
    createWorkerWindow(initialUrl, desiredMode);
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
