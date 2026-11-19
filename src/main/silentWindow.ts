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
 * Whether opacity takes part in hiding. Not on Windows: Electron makes a window WS_EX_LAYERED on its
 * first `setOpacity()` and never clears it, and a layered Chromium window has no title bar or frame
 * from then on — the revealed worker had no caption, no close button and white borders (Electron
 * 45). Windows keeps an off-screen position as given, so the position alone hides it there.
 */
function hidesWithOpacity(): boolean {
  return process.platform !== 'win32';
}

/**
 * Call right BEFORE `showInactive()`, so the window never flashes at its default spot before
 * {@link parkWindowOffscreen} moves it: transparent where the position only sticks once mapped,
 * already off screen on Windows.
 */
export function hideBeforeMapping(win: BrowserWindow): void {
  try {
    if (win.isDestroyed()) return;
    if (hidesWithOpacity()) win.setOpacity(0);
    else win.setPosition(OFFSCREEN_COORD, OFFSCREEN_COORD);
  } catch {
  }
}

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
    if (hidesWithOpacity()) win.setOpacity(0);
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
    if (hidesWithOpacity()) win.setOpacity(1);
  } catch {
  }
}
