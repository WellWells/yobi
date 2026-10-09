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

// Off every display arrangement, though macOS may still clamp it back onto one.
const OFFSCREEN_COORD = -10_000;

/**
 * Hides a window that still has to render (a never-shown window stalls Chromium's rendering).
 *
 * macOS clamps a window's frame back onto a display, so the off-screen position is best-effort;
 * `setIgnoreMouseEvents` lets clicks pass through whatever part stays on screen.
 * Call AFTER `showInactive()`: the position only takes effect once mapped.
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
