import type { BrowserWindow } from 'electron';

export const SILENT_WEB_PREFERENCES = {
  autoplayPolicy: 'document-user-activation-required',
} as const;

export function muteWindow(win: BrowserWindow, muted = true): void {
  try {
    if (!win.isDestroyed()) win.webContents.setAudioMuted(muted);
  } catch {
  }
}

// Far enough that any display arrangement puts the window outside it — as a REQUEST, which
// is all a position ever is.
const OFFSCREEN_COORD = -10_000;

/**
 * Hides a window that still has to render.
 *
 * A window that has never been shown stalls Chromium's rendering lifecycle, so these are
 * mapped and then made invisible instead. Getting that invisibility right takes all three
 * of the calls below, and the third is the one that was missing:
 *
 * **macOS clamps a window's frame back onto a display.** Measured 2026-08-30 on a 1408x881
 * screen: asking for [-10000, -10000] lands the window at [0, 30] at 1280x778 — a sheet of
 * invisible glass over nearly the whole desktop, swallowing every click aimed at the app's
 * real window. The user sees a main window that has stopped responding. `setPosition` again
 * once the window is mapped gets most of the way off (measured [-1240, 30]) but never all
 * the way, and `enableLargerThanScreen` does NOT help — it permits a window LARGER than the
 * screen, not one positioned off it. So the position is best-effort and
 * `setIgnoreMouseEvents` is what actually makes the remainder harmless: clicks pass through
 * to whatever is underneath. Nothing is lost, because these windows are driven by
 * `executeJavaScript` and CDP, never by a real cursor.
 *
 * Call AFTER `showInactive()` — the re-applied position only takes effect once mapped.
 */
export function parkWindowOffscreen(win: BrowserWindow): void {
  try {
    if (win.isDestroyed()) return;
    win.setOpacity(0);
    win.setPosition(OFFSCREEN_COORD, OFFSCREEN_COORD);
    win.setIgnoreMouseEvents(true);
  } catch {
  }
}

/** Undoes {@link parkWindowOffscreen} for a window being deliberately shown to the user. */
export function unparkWindow(win: BrowserWindow): void {
  try {
    if (win.isDestroyed()) return;
    win.setIgnoreMouseEvents(false);
    win.setOpacity(1);
  } catch {
  }
}
