import { screen, type BrowserWindow } from 'electron';
import { config, saveConfig } from './config';
import type { WindowBounds } from './configTypes';

/**
 * Remembers where the main window was left.
 *
 * Every launch used to open 1100x700, centred, whatever the user had done last time — on a
 * desktop app that is the kind of thing you notice every single day. The stored rect is the
 * *restored* one (`getNormalBounds()`), so a maximized window comes back maximized AND
 * un-maximizes to the size it had before.
 */

/** Writes are debounced: `resize` and `move` fire continuously while dragging. */
const SAVE_DEBOUNCE_MS = 400;

/** How much of the window has to land on a display for the position to be worth restoring. */
const MIN_VISIBLE_PX = 80;

export const DEFAULT_WINDOW_SIZE = { width: 1_100, height: 700 } as const;

/**
 * True when enough of `bounds` overlaps some display's work area to grab and move.
 * A monitor can be unplugged, or a display can be rearranged, between runs; restoring blind
 * puts the window somewhere with no title bar to drag.
 */
function isReachable(bounds: WindowBounds): boolean {
  return screen.getAllDisplays().some(({ workArea }) => {
    const overlapX = Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x);
    const overlapY = Math.min(bounds.y + bounds.height, workArea.y + workArea.height) - Math.max(bounds.y, workArea.y);
    return overlapX >= MIN_VISIBLE_PX && overlapY >= MIN_VISIBLE_PX;
  });
}

/**
 * The size and position to open with, or just the default size when there is nothing usable
 * stored — in which case the caller leaves `x`/`y` off so Electron centres the window.
 */
export function restoredWindowOptions(): { width: number; height: number; x?: number; y?: number } {
  const saved = config.windowBounds;
  if (!saved) return { ...DEFAULT_WINDOW_SIZE };
  const size = { width: saved.width, height: saved.height };
  // A maximized window is restored by calling maximize() after creation; its stored rect is
  // the un-maximized one, and it still has to be reachable for the un-maximize to be usable.
  if (!isReachable(saved)) return size;
  return { ...size, x: saved.x, y: saved.y };
}

export function shouldStartMaximized(): boolean {
  return config.windowBounds?.maximized === true;
}

/**
 * Starts persisting `win`'s geometry. Returns a teardown for tests; the app itself keeps it
 * for the window's lifetime.
 */
export function trackWindowBounds(win: BrowserWindow): () => void {
  let timer: NodeJS.Timeout | null = null;

  const capture = (): void => {
    if (win.isDestroyed() || win.isMinimized()) return;
    // getNormalBounds() is the rect the window would have if un-maximized — getBounds() during
    // a maximized session would store the screen-sized rect and lose the user's real size.
    const { x, y, width, height } = win.getNormalBounds();
    const next: WindowBounds = { x, y, width, height, maximized: win.isMaximized() };
    const prev = config.windowBounds;
    if (prev
      && prev.x === next.x && prev.y === next.y
      && prev.width === next.width && prev.height === next.height
      && prev.maximized === next.maximized) return;
    saveConfig({ windowBounds: next });
  };

  const scheduleCapture = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(capture, SAVE_DEBOUNCE_MS);
  };

  win.on('resize', scheduleCapture);
  win.on('move', scheduleCapture);
  win.on('maximize', scheduleCapture);
  win.on('unmaximize', scheduleCapture);
  // Closing to tray never fires 'closed', and a debounced write pending at quit would be lost.
  win.on('close', () => {
    if (timer) clearTimeout(timer);
    timer = null;
    capture();
  });

  return () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
}
