import { app, BrowserWindow, globalShortcut, screen } from 'electron';
import type { DisplayLike, Point, Rect, Size } from './geometry';
import { displayAtPoint } from './geometry';
import { REGION_OVERLAY_SCRIPT, REGION_OVERLAY_URL, parseOverlayAnswer } from './overlayPage';
import type { OverlayPayload } from './overlayPage';
import { SILENT_WEB_PREFERENCES, muteWindow } from '../silentWindow';

export interface OverlayShot {
  display: DisplayLike;
  /** The frozen picture shown under the dimming, as a data: URL. */
  imageUrl: string;
}

export interface OverlaySelection {
  displayId: number;
  /** CSS pixels of that display's overlay. */
  rect: Rect;
  /** The overlay's own size, which the frozen picture fills edge to edge. */
  viewport: Size;
}

export interface OverlayOptions {
  hint: string;
  /** Where the pointer was at the press: that display's overlay takes the keyboard. */
  cursor: Point;
  /**
   * Runs once a region is chosen, while the overlays are still up. Bringing the main window
   * forward here, before they close, keeps Yobi the foreground app — once they are gone Windows
   * hands the foreground back to whatever was under them.
   */
  beforeClose?: () => void;
}

/** A forgotten overlay would cover every screen; it gives up on its own after this long. */
export const OVERLAY_TIMEOUT_MS = 120_000;
const ESCAPE = 'Escape';

const DISPLAY_EVENTS = ['display-added', 'display-removed', 'display-metrics-changed'] as const;

/**
 * A display plugged, unplugged, moved or rescaled leaves the frozen pictures out of place. A
 * work-area change alone (the taskbar or Dock moving) does not, so it is not a reason to cancel.
 */
export function invalidatesOverlay(event: string, changedMetrics?: readonly string[]): boolean {
  if (event !== 'display-metrics-changed') return true;
  return (changedMetrics ?? []).some((metric) => metric === 'bounds' || metric === 'scaleFactor' || metric === 'rotation');
}

let sessionOpen = false;

export function isOverlayOpen(): boolean {
  return sessionOpen;
}

function createOverlayWindow(display: DisplayLike): BrowserWindow {
  const win = new BrowserWindow({
    ...display.bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hiddenInMissionControl: true,
    alwaysOnTop: true,
    // macOS keeps a window below the menu bar unless it may be larger than the screen.
    enableLargerThanScreen: true,
    roundedCorners: false,
    // The one window in src/main that is meant to take the keyboard (background windows are
    // `focusable: false`): the user drags in it and presses Esc or Enter,
    // which a window that cannot become key never receives. It is on screen, under the pointer,
    // and gone the moment the box is drawn, so there is no hidden key window left behind.
    focusable: true,
    webPreferences: {
      ...SILENT_WEB_PREFERENCES,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  // Above the taskbar, the menu bar and full-screen apps.
  win.setAlwaysOnTop(true, 'screen-saver');
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  }
  // A frozen picture never plays sound; silenced anyway so no window in src/main is audible by accident.
  muteWindow(win);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // A file dropped on the overlay would otherwise navigate it away from the picture.
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  return win;
}

async function prepareOverlay(win: BrowserWindow, payload: OverlayPayload): Promise<boolean> {
  await win.loadURL(REGION_OVERLAY_URL);
  await win.webContents.executeJavaScript(REGION_OVERLAY_SCRIPT);
  const ready = await win.webContents.executeJavaScript(`window.__yobiRegion.prepare(${JSON.stringify(payload)})`);
  return ready === true;
}

/**
 * Covers every display with its frozen picture and waits for one box. Resolves the selection,
 * or null on Esc, right-click, a closed overlay, a display change or the timeout; throws when an
 * overlay could not load its picture. Every overlay window is destroyed before this settles,
 * whichever way it ends.
 */
export async function runOverlaySession(shots: readonly OverlayShot[], options: OverlayOptions): Promise<OverlaySelection | null> {
  if (sessionOpen || shots.length === 0) return null;
  sessionOpen = true;

  const overlays: Array<{ win: BrowserWindow; shot: OverlayShot }> = [];
  let settled = false;
  let resolveOutcome: (value: OverlaySelection | null) => void = () => {};
  const outcome = new Promise<OverlaySelection | null>((resolve) => { resolveOutcome = resolve; });
  const settle = (value: OverlaySelection | null): void => {
    if (settled) return;
    settled = true;
    resolveOutcome(value);
  };
  const cancel = (): void => settle(null);
  const timer = setTimeout(cancel, OVERLAY_TIMEOUT_MS);
  const displayListeners = DISPLAY_EVENTS.map((event) => ({
    event,
    listener: (_event: unknown, _display: unknown, changedMetrics?: string[]): void => {
      if (invalidatesOverlay(event, changedMetrics)) cancel();
    },
  }));
  let escapeBound = false;

  try {
    for (const shot of shots) {
      const win = createOverlayWindow(shot.display);
      overlays.push({ win, shot });
      win.on('closed', cancel);
    }
    for (const { event, listener } of displayListeners) screen.on(event as 'display-metrics-changed', listener);

    const prepared = Promise.all(overlays.map(({ win, shot }) => prepareOverlay(win, {
      image: shot.imageUrl,
      scaleFactor: shot.display.scaleFactor,
      hint: options.hint,
    })));
    // Lost the race below to a cancel, its failure must not surface as an unhandled rejection.
    prepared.catch(() => {});
    // Something cancelled while the pages loaded (a closed window, a display change, the timeout).
    const ready = await Promise.race([prepared, outcome.then(() => null)]);
    if (ready === null || settled) return null;
    if (ready.some((ok) => !ok)) throw new Error('The overlay could not show the screen picture');

    for (const { win, shot } of overlays) {
      win.show();
      // Windows can size a window created on a display of another scale wrongly; placing it
      // again once it is on that display settles it.
      win.setBounds(shot.display.bounds);
    }
    const keyDisplay = displayAtPoint(overlays.map(({ shot }) => shot.display), options.cursor);
    const keyOverlay = overlays.find(({ shot }) => shot.display === keyDisplay) ?? overlays[0];
    if (process.platform === 'darwin') app.focus({ steal: true });
    keyOverlay.win.focus();
    keyOverlay.win.webContents.focus();
    // Belt and braces for Esc: if the OS refused to hand the overlay the keyboard, the key still
    // reaches us. Released in the finally below with everything else.
    try {
      escapeBound = globalShortcut.register(ESCAPE, cancel);
    } catch {
      escapeBound = false;
    }

    for (const { win, shot } of overlays) {
      void (win.webContents.executeJavaScript('window.__yobiRegion.result()') as Promise<unknown>).then((raw) => {
        const answer = parseOverlayAnswer(raw);
        if (answer.kind !== 'select') {
          cancel();
          return;
        }
        settle({ displayId: shot.display.id, rect: answer.rect, viewport: answer.viewport });
      }, cancel);
    }

    const selection = await outcome;
    if (selection) {
      try {
        options.beforeClose?.();
      } catch {
      }
    }
    return selection;
  } finally {
    settle(null);
    clearTimeout(timer);
    for (const { event, listener } of displayListeners) screen.removeListener(event as 'display-metrics-changed', listener);
    if (escapeBound) {
      try {
        globalShortcut.unregister(ESCAPE);
      } catch {
      }
    }
    for (const { win } of overlays) {
      if (!win.isDestroyed()) win.destroy();
    }
    sessionOpen = false;
  }
}
