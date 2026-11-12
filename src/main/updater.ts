import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { IPC } from '../shared/types';
import type { UpdateAvailablePayload } from '../shared/types';
import { errorText } from '../shared/errorText';
import { isHttpUrl, sendWebNotification, setBeforeRelaunch } from './helpers';
import { getLangCache, t } from './i18n';
import { getAppVersion } from './appVersion';

interface UpdaterDeps {
  sendLog: (message: string) => void;
  sendToRenderer: (channel: string, ...args: unknown[]) => void;
}

const RELEASES_BASE_URL = 'https://github.com/WellWells/yobi/releases';

/** The app can stay open for days in the tray, so a check at launch alone would miss a release. */
const UPDATE_RECHECK_INTERVAL_MS = 6 * 60 * 60_000;

let initialized = false;
let checking = false;
/** The update being downloaded or waiting to install; a check repeats it instead of starting over. */
let pendingUpdate: UpdateAvailablePayload | null = null;
let readyToInstall = false;
let sendLogRef: UpdaterDeps['sendLog'] = () => {};
let sendToRendererRef: UpdaterDeps['sendToRenderer'] = () => {};

function normalizeVersion(rawVersion: unknown): string {
  if (typeof rawVersion === 'string' && rawVersion.trim()) return rawVersion.trim();
  return getAppVersion();
}

function readStringField(source: unknown, key: string): string | null {
  if (!source || typeof source !== 'object') return null;
  const value = (source as Record<string, unknown>)[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function buildReleaseTagUrl(version: string): string {
  const normalizedVersion = version.startsWith('v') ? version : `v${version}`;
  return `${RELEASES_BASE_URL}/tag/${normalizedVersion}`;
}

function resolveReleaseUrl(updateInfo: unknown, version: string): string {
  const candidates = [
    readStringField(updateInfo, 'releaseUrl'),
    readStringField(updateInfo, 'releaseURL'),
    readStringField(updateInfo, 'htmlUrl'),
    readStringField(updateInfo, 'url'),
  ].filter((value): value is string => Boolean(value));

  for (const url of candidates) {
    if (isHttpUrl(url)) return url;
  }

  return buildReleaseTagUrl(version);
}

/**
 * Only the GitHub build on Windows replaces itself. macOS refuses an update for an app without a
 * Developer ID signature, and the Store updates its own build.
 */
function installsUpdatesItself(): boolean {
  return process.platform === 'win32' && !process.windowsStore && app.isPackaged;
}

/**
 * For a quit that must not start the installer: Windows shutting down would kill it halfway
 * through, and a relaunch would start the app while the installer replaces it. The download stays
 * in the updater's cache, so the next launch finds it again.
 */
function skipInstallOnQuit(): void {
  autoUpdater.autoInstallOnAppQuit = false;
}

/** Electron reports the end of the Windows session on windows, not on the app. */
function watchSessionEnd(window: BrowserWindow): void {
  window.on('session-end', skipInstallOnQuit);
}

export function initializeUpdater(deps: UpdaterDeps): void {
  if (initialized) return;

  sendLogRef = deps.sendLog;
  sendToRendererRef = deps.sendToRenderer;

  const selfInstalling = installsUpdatesItself();
  autoUpdater.autoDownload = selfInstalling;
  autoUpdater.autoInstallOnAppQuit = selfInstalling;

  autoUpdater.on('update-available', (info: unknown) => {
    const version = normalizeVersion(readStringField(info, 'version'));
    const releaseUrl = resolveReleaseUrl(info, version);
    const payload: UpdateAvailablePayload = { version, releaseUrl, autoDownload: selfInstalling };
    sendLogRef(`⬆️ Update available: ${version}`);
    sendToRendererRef(IPC.UPDATE_AVAILABLE, payload);

    if (selfInstalling) {
      pendingUpdate = payload;
      return;
    }

    // Through the shared helper so the "notify me" switch and the in-app fallback both apply.
    const strings = getLangCache();
    sendWebNotification(
      t(strings, 'notify.update.available.title', { version }),
      t(strings, 'notify.update.available.body'),
      'info',
    );
  });

  autoUpdater.on('update-downloaded', (info: unknown) => {
    const version = normalizeVersion(readStringField(info, 'version'));
    pendingUpdate = pendingUpdate ?? {
      version,
      releaseUrl: resolveReleaseUrl(info, version),
      autoDownload: true,
    };
    readyToInstall = true;
    sendLogRef(`✅ Update ${version} is ready to install`);
    sendToRendererRef(IPC.UPDATE_DOWNLOADED, pendingUpdate);

    const strings = getLangCache();
    sendWebNotification(
      t(strings, 'notify.update.ready.title', { version }),
      t(strings, 'notify.update.ready.body'),
      'info',
    );
  });

  autoUpdater.on('update-not-available', () => {
    sendLogRef('✅ Already on latest version');
    sendToRendererRef(IPC.UPDATE_NOT_AVAILABLE);
  });

  autoUpdater.on('error', (error: unknown) => {
    const msg = errorText(error);
    sendLogRef(`⚠️ Update check failed: ${msg}`);
    // A failed download or install falls back to the manual route, and the next check retries.
    pendingUpdate = null;
    readyToInstall = false;
    // Offline included: a check that never reached the server has not shown we are up to date.
    sendToRendererRef(IPC.UPDATE_ERROR);
  });

  if (selfInstalling) {
    BrowserWindow.getAllWindows().forEach(watchSessionEnd);
    app.on('browser-window-created', (_event, window) => watchSessionEnd(window));
    setBeforeRelaunch(skipInstallOnQuit);
    setInterval(() => { void checkForUpdates(); }, UPDATE_RECHECK_INTERVAL_MS);
  }

  initialized = true;
}

export async function checkForUpdates(): Promise<boolean> {
  if (process.windowsStore) return false;
  if (!initialized || !app.isPackaged || checking) return false;

  if (pendingUpdate) {
    sendToRendererRef(readyToInstall ? IPC.UPDATE_DOWNLOADED : IPC.UPDATE_AVAILABLE, pendingUpdate);
    return true;
  }

  checking = true;
  try {
    await autoUpdater.checkForUpdates();
    return true;
  } catch {
    return false;
  } finally {
    checking = false;
  }
}

/** Closes the app, runs the installer without its window, and reopens the new version. */
export function installUpdate(): boolean {
  if (!readyToInstall) return false;
  autoUpdater.quitAndInstall(true, true);
  return true;
}
