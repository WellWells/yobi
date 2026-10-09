import { IPC } from '../../shared/types';
import { installAppMenu } from '../appMenu';
import { sendToRenderer, setMainWindow } from '../helpers';
import { createMainWindow, getMainWin } from '../windows';

/**
 * The menu bar stays Yobi's after the window is closed on macOS (the app keeps running), so
 * Settings… may have no window to show. A fresh window only hears the request once its
 * renderer has loaded.
 */
function openSettings(): void {
  let win = getMainWin();
  if (!win || win.isDestroyed()) {
    createMainWindow();
    win = getMainWin();
    setMainWindow(win);
    win?.webContents.once('did-finish-load', () => sendToRenderer(IPC.NAVIGATE_SETTINGS));
  } else {
    sendToRenderer(IPC.NAVIGATE_SETTINGS);
  }
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

export function setupAppMenu(): void {
  installAppMenu({ onOpenSettings: openSettings });
}
