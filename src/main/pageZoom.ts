import type { WebContents } from 'electron';

/**
 * Keeps one of Yobi's own pages (main window, export capture, quick-export panel) at 100% page
 * zoom, whatever the user presses and whatever Chromium remembered for the origin. Size belongs
 * to the OS display scale, which follows the screen in use (a remote session gets its own); a
 * stored app zoom does not, so a Ctrl+- pressed over a remote session shrinks the app at the desk.
 *
 * On every main-frame load: clear the origin's stored level while the contents still follows it
 * (that write is what un-shrinks an app stuck at 83%, for every window on the origin), then
 * disable zoom so menu roles and setZoomLevel calls are ignored. The mode alone does not pin a
 * page: a document loaded under 'disabled' still opens at the stored level, and a reload drops
 * the pin, so this runs again on each navigation. Measured on Electron 44.
 */
export function pinPageZoom(contents: WebContents): void {
  contents.on('did-navigate', () => {
    if (contents.isDestroyed()) return;
    contents.setZoomMode('default');
    contents.setZoomLevel(0);
    contents.setZoomMode('disabled');
  });
}
