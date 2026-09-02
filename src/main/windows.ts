import { app, BrowserWindow, nativeImage, nativeTheme, shell } from 'electron';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { sendLog, sendWebNotification, getAssetPath, setWorkerAttention } from './helpers';
import { toggleTempChatMode } from './tempChat';
import { getLangCache, t } from './i18n';
import { CLEAN_UA } from './userAgent';
import { applyWorkerUserAgent } from './clientHints';
import { SILENT_WEB_PREFERENCES, muteWindow, parkWindowOffscreen, unparkWindow } from './silentWindow';
import { PROVIDER_URLS, isByokTargetUrl } from '../shared/types';
import { themeBackground } from '../shared/themes';
import { config } from './config';
import { activeCombos, fromElectronInput, matchesCombo, shortcutById } from '../shared/shortcuts';
import { isHotkeyPaused } from './hotkey';

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
    backgroundColor: themeBackground(config.theme, nativeTheme.shouldUseDarkColors),
    icon: getWindowIcon(),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  // Opt-in: a detached DevTools is a second renderer plus its own bundle, and it
  // lands right on top of the window's first paint. Set YOBI_DEVTOOLS=1 to get it
  // back automatically — otherwise it is one keystroke away.
  if (isDev && process.env['YOBI_DEVTOOLS']) {
    mainWin.webContents.openDevTools({ mode: 'detach' });
  }

  if (isDev) {
    mainWin.loadURL(process.env['ELECTRON_RENDERER_URL'] as string);
  } else {
    mainWin.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWin.setMenuBarVisibility(false);

  mainWin.webContents.on('will-navigate', (event, url) => {
    if (url === mainWin?.webContents.getURL()) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWin.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return;
    if (isHotkeyPaused()) return;
    const def = shortcutById('app.tempChat');
    const combos = activeCombos(def, process.platform === 'darwin', config.shortcuts['app.tempChat']);
    const pressed = fromElectronInput(input);
    const isMac = process.platform === 'darwin';
    if (!combos.some((combo) => matchesCombo(pressed, combo, [], { isMac }))) return;
    event.preventDefault();
    toggleTempChatMode();
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
        ...SILENT_WEB_PREFERENCES,
      }
    : {
        partition: WORKER_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        ...SILENT_WEB_PREFERENCES,
      };

  workerWin = new BrowserWindow({
    width: 1_280,
    height: 900,
    show: false,
    frame: true,
    autoHideMenuBar: true,
    skipTaskbar: true,
    hiddenInMissionControl: process.platform === 'darwin',
    // NOT focusable while it is the invisible automation window, which is the whole point:
    // `webContents.focus()` also focuses the OWNER WINDOW on macOS and Linux (Electron does
    // it deliberately, to match Windows — see the #if in WebContents::Focus), so a focusable
    // worker parked offscreen at opacity 0 becomes the key window on every send. The user
    // sees nothing move, but the main window stops responding to clicks until Cmd+` cycles
    // back to it. A window that cannot become key still gives its renderer real focus, so
    // this costs nothing and `revealWorkerWindow` turns it back on.
    focusable: false,
    hasShadow: false,
    title: 'Provider Worker',
    webPreferences,
  });
  workerWindowMode = mode;

  workerWin.setMenuBarVisibility(false);

  // Transparent BEFORE it is mapped so it never flashes, parked AFTER because the position
  // only sticks once macOS has a frame to clamp — see parkWindowOffscreen.
  workerWin.setOpacity(0);
  workerWin.showInactive();
  parkWindowOffscreen(workerWin);

  workerWin.on('move', () => rememberWorkerVisibleBounds());
  workerWin.on('resize', () => rememberWorkerVisibleBounds());

  applyWorkerUserAgent(workerWin.webContents, CLEAN_UA);
  muteWindow(workerWin);
  workerWin.loadURL(bootUrl);

  // Every provider page has to believe it is focused. Several of them slow their streaming
  // right down while they think they are a background tab — "it only answers fast once I
  // open the worker window" is that, and only Gemini had a workaround for it
  // (`applyVisibilityPatch`, which fakes the flags in JS rather than being focused).
  // Re-asserted per navigation because a new document starts unfocused. Measured on macOS:
  // with a non-focusable window this leaves `document.hasFocus()` true even after the user
  // clicks back to the main window, and the key window never moves.
  workerWin.webContents.on('did-finish-load', () => {
    if (!workerWin || workerWin.isDestroyed()) return;
    // Revealed: the window is on screen and the user owns focus, so do not grab it.
    if (workerWin.isFocusable()) return;
    workerWin.webContents.focus();
  });

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
  unparkWindow(workerWin);
  muteWindow(workerWin, false);
  workerWin.setFocusable(true);
  workerWin.show();
  workerWin.focus();
  if (!app.isPackaged) workerWin.webContents.openDevTools({ mode: 'detach' });
  rememberWorkerVisibleBounds();
  setWorkerAttention('idle');
}

export function hideWorkerWindow(): void {
  if (!workerWin || workerWin.isDestroyed()) return;
  rememberWorkerVisibleBounds();
  muteWindow(workerWin);
  workerWin.setSkipTaskbar(true);
  // Back to the state that cannot steal the key window.
  workerWin.setFocusable(false);
  if (workerWin.isVisible()) parkWindowOffscreen(workerWin);
}

function rememberWorkerVisibleBounds(): void {
  if (!workerWin || workerWin.isDestroyed()) return;
  if (!workerWin.isVisible()) return;
  if (workerWin.getOpacity() < 0.99) return;
  const [x, y] = workerWin.getPosition();
  if (x <= -9_000 || y <= -9_000) return;
  workerVisibleBounds = workerWin.getBounds();
}

function shouldSwitchWorkerMode(desired: WorkerWindowMode): boolean {
  if (desired === 'interactive') return true;
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
