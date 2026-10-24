import { app, BrowserWindow, nativeImage, nativeTheme, shell } from 'electron';
import type { WebContents } from 'electron';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { sendLog, sendToRenderer, sendWebNotification, getAssetPath, setWorkerAttention } from './helpers';
import { toggleTempChatMode } from './tempChat';
import { getLangCache, t } from './i18n';
import { WORKER_USER_AGENTS } from './userAgent';
import { applyWorkerUserAgent } from './clientHints';
import { SILENT_WEB_PREFERENCES, muteWindow, parkWindowOffscreen, unparkWindow } from './silentWindow';
import { IPC, PROVIDER_URLS, isByokTargetUrl, providerFromUrl } from '../shared/types';
import { themeBackground } from '../shared/themes';
import { config } from './config';
import { activeCombos, fromElectronInput, matchesCombo, shortcutById } from '../shared/shortcuts';
import { isHotkeyPaused } from './hotkey';
import { restoredWindowOptions, shouldStartMaximized, trackWindowBounds } from './windowBounds';
import { llmLane } from './flow/lanes';
import { forwardTrackpadGestures } from './trackpadGesture';
import { deferSignInPrompt } from './deferredSignIn';

const WORKER_PARTITION = 'persist:gemini';
type WorkerWindowMode = 'automation' | 'interactive';

/** Exported so every window Yobi opens wears Yobi's icon, not Electron's default. */
export function getWindowIcon(): Electron.NativeImage {
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
// Whether the worker is on screen for the user. NOT the same question as `isVisible()`:
// background workers are mapped and then parked (opacity 0, offscreen) because a window that
// has never been shown stalls Chromium's rendering, so `isVisible()` is true for those too.
let workerRevealed = false;
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

/** The worker is on screen for the user (a sign-in or a challenge): background work keeps out. */
export function isWorkerRevealed(): boolean {
  return workerRevealed;
}

export function setAppQuitting(value: boolean): void {
  isAppQuitting = value;
}

/**
 * Launched at login straight into the tray. Windows only registers `--hidden` when closing to
 * the tray is on, and without a tray a hidden window would have no way back.
 */
export function shouldStartHidden(argv: readonly string[] = process.argv): boolean {
  return config.closeToTray && argv.includes('--hidden');
}

interface MainWindowOptions {
  /**
   * For the boot window only: a window re-created later (second instance, the macOS menu) is
   * opened because the user asked for it.
   */
  startHidden?: boolean;
}

export function createMainWindow(options?: MainWindowOptions): void {
  const startHidden = options?.startHidden === true;
  const isDev = !app.isPackaged;
  const preloadPath = path.join(__dirname, '../preload/index.js');

  mainWin = new BrowserWindow({
    // Size and position come from the last session; without x/y Electron centres the window,
    // which is what a first run (or an unplugged monitor) should get.
    ...restoredWindowOptions(),
    // A login start must never be mapped: hiding it afterwards still flashes it and takes focus.
    show: !startHidden,
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
  // Opt-in (YOBI_DEVTOOLS=1): a detached DevTools is a second renderer that lands on the first paint.
  if (isDev && process.env['YOBI_DEVTOOLS']) {
    mainWin.webContents.openDevTools({ mode: 'detach' });
  }

  if (isDev) {
    mainWin.loadURL(process.env['ELECTRON_RENDERER_URL'] as string);
  } else {
    mainWin.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  if (startHidden) {
    // maximize() maps a hidden window, so it waits for the first show. So does tracking: quitting
    // from the tray before that would store the never-maximized window over the saved state.
    const win = mainWin;
    win.once('show', () => {
      if (win.isDestroyed()) return;
      if (shouldStartMaximized()) win.maximize();
      trackWindowBounds(win);
    });
  } else {
    if (shouldStartMaximized()) mainWin.maximize();
    trackWindowBounds(mainWin);
  }

  // The title bar is ours, so the maximize button has to be told when the state changes —
  // otherwise it keeps the "maximize" glyph and tooltip while the window is already maximized.
  // The renderer also asks once on mount, for the restored-maximized case that happens before
  // it has loaded.
  const emitMaximized = (): void => sendToRenderer(IPC.WINDOW_MAXIMIZED_CHANGED, mainWin?.isMaximized() === true);
  mainWin.on('maximize', emitMaximized);
  mainWin.on('unmaximize', emitMaximized);

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
  forwardTrackpadGestures(mainWin.webContents);

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

export function destroyWorkerWindowForModeSwitch(): void {
  workerRevealed = false;
  if (!workerWin || workerWin.isDestroyed()) return;
  const previousWorkerWin = workerWin;
  previousWorkerWin.removeAllListeners('close');
  previousWorkerWin.removeAllListeners('closed');
  previousWorkerWin.destroy();
  workerWin = null;
  workerWindowMode = null;
}

/** The page the worker opens on: a BYOK target has no web page, so Gemini stands in. */
function workerHomeUrl(targetUrl: string): string {
  return isByokTargetUrl(targetUrl) ? PROVIDER_URLS.gemini : targetUrl;
}

export function createWorkerWindow(initialUrl: string, mode: WorkerWindowMode = 'automation'): void {
  const bootUrl = workerHomeUrl(initialUrl);
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
    // Not focusable while hidden: on macOS/Linux `webContents.focus()` also focuses the owner window,
    // so a parked worker would steal the key window. `revealWorkerWindow` turns it back on.
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

  applyWorkerUserAgent(workerWin.webContents, WORKER_USER_AGENTS[providerFromUrl(bootUrl)]);
  muteWindow(workerWin);
  workerWin.loadURL(bootUrl);

  // Give the page renderer focus so provider pages do not throttle streaming as a background tab;
  // re-asserted per navigation because a new document starts unfocused.
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
    workerRevealed = false;
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
  workerRevealed = true;
  setWorkerAttention('idle');
}

/**
 * The title bar's "Browser Window" button. A worker parked on about:blank is first sent to the
 * current provider. Runs inside `llmLane`, so it never navigates under a running send.
 */
export async function showWorkerWindow(targetUrl: string): Promise<void> {
  const win = await ensureWorkerWindow(targetUrl);
  if (!win) return;
  revealWorkerWindow();
  await llmLane.runExclusive(async () => {
    const url = win.isDestroyed() ? 'gone' : win.webContents.getURL();
    if (url !== '' && url !== 'about:blank') return;
    await win.webContents.loadURL(workerHomeUrl(targetUrl)).catch(() => {});
  });
}

export function hideWorkerWindow(): void {
  workerRevealed = false;
  if (!workerWin || workerWin.isDestroyed()) return;
  // Dev builds open DevTools beside the revealed worker; it would outlive the window it inspects.
  if (workerWin.webContents.isDevToolsOpened()) workerWin.webContents.closeDevTools();
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

/**
 * Whether a mode change may rebuild the worker. Return to automation as soon as the user is done
 * with the revealed window: the interactive window carries no worker preload. Checks
 * `workerRevealed`, not `isVisible()`, which a parked background window always answers true to.
 */
function shouldSwitchWorkerMode(desired: WorkerWindowMode): boolean {
  if (desired === 'interactive') return true;
  if (!workerWin || workerWin.isDestroyed()) return true;
  return !workerRevealed;
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

export async function showLoginWindowIfNeeded(
  providerLabel: string,
  targetUrl: string,
  /** Runs on the loaded page when targetUrl is only where the sign-in starts. */
  startSignIn?: (contents: WebContents) => Promise<void>,
): Promise<void> {
  // A send that may still go to another provider decides afterwards whether this window opens.
  if (deferSignInPrompt(() => showLoginWindowIfNeeded(providerLabel, targetUrl, startSignIn))) {
    sendLog(`🔐 ${providerLabel} requires login — the sign-in window waits until the other signed-in AIs have been tried`);
    return;
  }
  const win = await showInteractiveWorkerWindow(targetUrl);
  if (!win) return;
  if (startSignIn) await startSignIn(win.webContents);
  setWorkerAttention('login');
  sendLog(`🔐 ${providerLabel} requires login — complete sign-in in the opened window`);
  const strings = getLangCache();
  sendWebNotification(
    t(strings, 'login.notify.title', { provider: providerLabel }),
    t(strings, 'login.notify.body'),
    'warning',
  );
}
