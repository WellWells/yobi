import type { BrowserWindow } from 'electron';

/*
 * Electron's default autoplayPolicy is `no-user-gesture-required` — more permissive than
 * Chrome's — so any page loaded into an offscreen window starts playing its media the moment
 * it renders, and the user hears a page they never opened.
 *
 * Every window that loads a remote page in the background spreads the fix over two layers:
 * this policy stops playback from starting at all (also saves the decode + bandwidth), and
 * muteWindow() silences whatever starts anyway — media already playing when the page
 * navigates, or a site that plays from a synthetic activation.
 */
export const SILENT_WEB_PREFERENCES = {
  autoplayPolicy: 'document-user-activation-required',
} as const;

export function muteWindow(win: BrowserWindow, muted = true): void {
  try {
    if (!win.isDestroyed()) win.webContents.setAudioMuted(muted);
  } catch {
  }
}
