import { BrowserWindow } from 'electron';
import type { WebContents } from 'electron';
import { sendLog } from './helpers';
import { loadURLFollowingIdentity } from './navigationIdentity';
import { getWindowIcon } from './windows';

const POLL_INTERVAL_MS = 1_500;

export interface SignInWindowSpec {
  /** Which sign-in the window serves. A request for another one only brings the open window forward. */
  id: string;
  /** Name for the log, e.g. "Gemini" or "X". */
  label: string;
  title: string;
  partition: string;
  url: string;
  prepare: (contents: WebContents) => void;
  /** Runs once the first page has loaded, before the poll starts. */
  afterLoad?: (contents: WebContents) => Promise<void>;
  isSignedIn: () => Promise<boolean>;
  /** Seen while the window was open; the window then closes itself. */
  onSignedIn: () => void;
  /** The user closed the window; `loggedIn` is the state it left behind. */
  onClosed: (loggedIn: boolean) => void;
}

interface OpenSignIn {
  win: BrowserWindow;
  id: string;
  label: string;
}

let current: OpenSignIn | null = null;

export function isSignInWindowOpen(): boolean {
  return Boolean(current && !current.win.isDestroyed());
}

/** One sign-in window at a time, whichever account it is for. Resolves false when another one is open. */
export async function openSignInWindow(spec: SignInWindowSpec): Promise<boolean> {
  if (current && !current.win.isDestroyed()) {
    current.win.focus();
    if (current.id !== spec.id) {
      sendLog(`ℹ️ A sign-in window is already open for ${current.label} — close it first`);
    }
    return current.id === spec.id;
  }

  const win = new BrowserWindow({
    width: 480,
    height: 760,
    title: spec.title,
    // Otherwise the taskbar and Alt+Tab show Electron's default icon.
    icon: getWindowIcon(),
    autoHideMenuBar: true,
    webPreferences: {
      partition: spec.partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  current = { win, id: spec.id, label: spec.label };
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let closedBySelf = false;

  const stopPolling = (): void => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  };

  // Attached before the first load: a window closed while still loading must still report back,
  // or the Settings row would spin forever.
  win.on('closed', () => {
    stopPolling();
    if (current?.win === win) current = null;
    if (closedBySelf) return;
    void (async () => {
      let loggedIn = false;
      try {
        loggedIn = await spec.isSignedIn();
      } catch {
      }
      spec.onClosed(loggedIn);
    })();
  });

  win.setMenuBarVisibility(false);
  spec.prepare(win.webContents);
  try {
    await loadURLFollowingIdentity(win.webContents, spec.url);
  } catch (err) {
    // The page itself shows what failed; the window stays usable and the poll still runs.
    sendLog(`⚠️ ${spec.label} sign-in page did not finish loading: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (win.isDestroyed()) return true;
  if (spec.afterLoad) await spec.afterLoad(win.webContents);

  pollTimer = setInterval(() => {
    void (async () => {
      if (win.isDestroyed()) {
        stopPolling();
        return;
      }
      let loggedIn = false;
      try {
        loggedIn = await spec.isSignedIn();
      } catch {
        return;
      }
      if (!loggedIn || win.isDestroyed()) return;
      stopPolling();
      spec.onSignedIn();
      closedBySelf = true;
      win.destroy();
    })();
  }, POLL_INTERVAL_MS);

  return true;
}
