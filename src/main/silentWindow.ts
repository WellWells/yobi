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
