import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { IPC } from '../shared/types';
import type { UpdateAvailablePayload } from '../shared/types';
import { isHttpUrl, sendWebNotification } from './helpers';
import { getLangCache, t } from './i18n';

interface UpdaterDeps {
  sendLog: (message: string) => void;
  sendToRenderer: (channel: string, ...args: unknown[]) => void;
}

const RELEASES_BASE_URL = 'https://github.com/WellWells/yobi/releases';

let initialized = false;
let checking = false;
let sendLogRef: UpdaterDeps['sendLog'] = () => {};
let sendToRendererRef: UpdaterDeps['sendToRenderer'] = () => {};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function normalizeVersion(rawVersion: unknown): string {
  if (typeof rawVersion === 'string' && rawVersion.trim()) return rawVersion.trim();
  return app.getVersion();
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

export function initializeUpdater(deps: UpdaterDeps): void {
  if (initialized) return;

  sendLogRef = deps.sendLog;
  sendToRendererRef = deps.sendToRenderer;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('update-available', (info: unknown) => {
    const version = normalizeVersion(readStringField(info, 'version'));
    const releaseUrl = resolveReleaseUrl(info, version);
    const payload: UpdateAvailablePayload = { version, releaseUrl };
    sendLogRef(`⬆️ Update available: ${version}`);
    sendToRendererRef(IPC.UPDATE_AVAILABLE, payload);

    // Through the shared helper so the "notify me" switch and the in-app fallback both apply.
    const strings = getLangCache();
    sendWebNotification(
      t(strings, 'notify.update.available.title', { version }),
      t(strings, 'notify.update.available.body'),
      'info',
    );
  });

  autoUpdater.on('update-not-available', () => {
    sendLogRef('✅ Already on latest version');
    sendToRendererRef(IPC.UPDATE_NOT_AVAILABLE);
  });

  autoUpdater.on('error', (error: unknown) => {
    const msg = getErrorMessage(error);
    sendLogRef(`⚠️ Update check failed: ${msg}`);
    // Offline included: a check that never reached the server has not shown we are up to date.
    sendToRendererRef(IPC.UPDATE_ERROR);
  });

  initialized = true;
}

export async function checkForUpdates(): Promise<boolean> {
  if (process.windowsStore) return false;
  if (!initialized || !app.isPackaged || checking) return false;

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
