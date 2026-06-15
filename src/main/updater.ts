import { app, Notification } from 'electron';
import { autoUpdater } from 'electron-updater';
import { IPC } from '../shared/types';
import type { UpdateAvailablePayload } from '../shared/types';
import { isHttpUrl } from './helpers';
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

function isNetworkError(error: unknown): boolean {
  const msg = getErrorMessage(error).toLowerCase();
  return (
    msg.includes('getaddrinfo') ||
    msg.includes('enotfound') ||
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('enetunreach') ||
    msg.includes('socket hang up') ||
    msg.includes('network timeout') ||
    msg.includes('failed to fetch') ||
    msg.includes('err_internet_disconnected') ||
    msg.includes('err_name_not_resolved')
  );
}

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

    if (Notification.isSupported()) {
      const strings = getLangCache();
      new Notification({
        title: t(strings, 'notify.update.available.title', { version }),
        body: t(strings, 'notify.update.available.body'),
        silent: false,
      }).show();
    }
  });

  autoUpdater.on('update-not-available', () => {
    sendLogRef('✅ Already on latest version');
    sendToRendererRef(IPC.UPDATE_NOT_AVAILABLE);
  });

  autoUpdater.on('error', (error: unknown) => {
    const msg = getErrorMessage(error);
    sendLogRef(`⚠️ Update check failed: ${msg}`);
    if (isNetworkError(error)) {
      sendToRendererRef(IPC.UPDATE_NOT_AVAILABLE);
    } else {
      sendToRendererRef(IPC.UPDATE_ERROR);
    }
  });

  initialized = true;
}

export async function checkForUpdates(): Promise<boolean> {
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
