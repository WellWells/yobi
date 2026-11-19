import { execFile } from 'node:child_process';
import { powerMonitor, screen, type BrowserWindow } from 'electron';
import { IPC } from '../shared/types';
import { parseWindowsTextScale } from '../shared/systemTextScale';

const WM_SETTINGCHANGE = 0x001a;
const TEXT_SCALE_KEY = 'HKCU\\Software\\Microsoft\\Accessibility';

/** Read the current session every time; a remote session must not inherit an app-stored scale. */
export function readSystemTextScale(): Promise<number> {
  if (process.platform !== 'win32') return Promise.resolve(100);
  return new Promise((resolve) => {
    execFile('reg.exe', ['query', TEXT_SCALE_KEY, '/v', 'TextScaleFactor'], {
      windowsHide: true,
      timeout: 2_000,
      maxBuffer: 8_192,
      encoding: 'utf8',
    }, (error, stdout) => resolve(error ? 100 : parseWindowsTextScale(stdout)));
  });
}

/**
 * Re-read on settings changes and after a display/session transition. Reads are serialized:
 * a change arriving during a read schedules another read instead of publishing an older result.
 */
export function watchSystemTextScale(
  win: BrowserWindow,
  publish: (percent: number) => void | Promise<void> = (percent) => win.webContents.send(IPC.SYSTEM_TEXT_SCALE_CHANGED, percent),
): () => void {
  if (process.platform !== 'win32') return () => {};
  // Held here because 'closed' fires after destruction, when reading win.webContents throws.
  const contents = win.webContents;
  let disposed = false;
  let reading = false;
  let pending = false;

  async function refresh(): Promise<void> {
    if (disposed) return;
    pending = true;
    if (reading) return;
    reading = true;
    try {
      while (pending && !disposed) {
        pending = false;
        const percent = await readSystemTextScale();
        if (!pending && !disposed && !win.isDestroyed() && !contents.isDestroyed()) {
          try { await publish(percent); } catch { /* The document may be navigating or closing. */ }
        }
      }
    } finally {
      reading = false;
    }
  }

  function changed(): void { void refresh(); }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    win.removeListener('focus', changed);
    contents.removeListener('did-finish-load', changed);
    screen.removeListener('display-metrics-changed', changed);
    powerMonitor.removeListener('resume', changed);
    win.removeListener('closed', dispose);
    if (!win.isDestroyed()) win.unhookWindowMessage(WM_SETTINGCHANGE);
  }

  win.hookWindowMessage(WM_SETTINGCHANGE, changed);
  win.on('focus', changed);
  contents.on('did-finish-load', changed);
  screen.on('display-metrics-changed', changed);
  powerMonitor.on('resume', changed);
  win.once('closed', dispose);
  changed();
  return dispose;
}
