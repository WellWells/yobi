import { app, Notification, session } from 'electron';
import type { BrowserWindow } from 'electron';
import * as path from 'node:path';
import type { UiNotificationPayload, WorkerAttention } from '../shared/types';
import { IPC, PROVIDER_URLS } from '../shared/types';
import { detectProvider, getProviderLabel } from './providers';

let _mainWin: BrowserWindow | null = null;
let _notifyEnabled = true;
let _workerReveal: (() => void) | null = null;
let _workerAttention: WorkerAttention = 'idle';

export function setMainWindow(win: BrowserWindow | null): void {
  _mainWin = win;
}

export function setWorkerReveal(fn: () => void): void {
  _workerReveal = fn;
}

export function setNotifyEnabled(enabled: boolean): void {
  _notifyEnabled = enabled;
}

export function applyLaunchAtStartup(enabled: boolean, hideOnStart: boolean = false): void {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return;
  if (process.platform === 'win32') {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: process.execPath,
      args: enabled && hideOnStart ? ['--hidden'] : [],
    });
  } else {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: enabled && hideOnStart,
    });
  }
}

export function relaunchApp(reason = 'restart requested'): void {
  sendLog(`🔄 Relaunching Yobi (${reason})...`);
  app.relaunch();
  setTimeout(() => app.quit(), 600);
}

export function sendLog(msg: string): void {
  const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
  const line = `[${time}] ${msg}`;
  console.log(line);
  sendToRenderer(IPC.LOG, line);
}

export function sendToRenderer(channel: string, ...args: unknown[]): void {
  if (_mainWin && !_mainWin.isDestroyed()) {
    _mainWin.webContents.send(channel, ...args);
  }
}

export function setWorkerAttention(state: WorkerAttention): void {
  _workerAttention = state;
  sendToRenderer(IPC.WORKER_STATUS, state);
}

export function getWorkerAttention(): WorkerAttention {
  return _workerAttention;
}

export function sendWebNotification(
  title: string,
  body: string,
  level: UiNotificationPayload['level'] = 'success',
  action?: UiNotificationPayload['action'],
): void {
  if (!_notifyEnabled) return;
  sendToRenderer(IPC.UI_NOTIFICATION, { title, body, level, action });
  if (!Notification.isSupported()) return;
  const notification = new Notification({
    title,
    body,
    urgency: level === 'error' ? 'critical' : 'normal',
    silent: false,
  });
  if (action?.id === 'open-worker-window' && _workerReveal) {
    notification.on('click', _workerReveal);
  }
  notification.show();
}

export function isHttpUrl(rawUrl: string): boolean {
  if (!rawUrl?.trim()) return false;
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeAiUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return PROVIDER_URLS.gemini;
  if (trimmed.includes('?')) return trimmed;
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

export function createTaskId(): string {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

export function isExpiredCookie(expirationDate?: number): boolean {
  if (!expirationDate) return false;
  return expirationDate * 1000 <= Date.now();
}

export async function hasPerplexityReusableSiteCookie(): Promise<boolean> {
  const workerSession = session.fromPartition('persist:gemini');
  const cookies = await workerSession.cookies.get({ url: PROVIDER_URLS.perplexity });
  return cookies.some(
    (cookie) =>
      (cookie.name.startsWith('__Secure-next-auth.session-token') || cookie.name === 'cf_clearance') &&
      !isExpiredCookie(cookie.expirationDate),
  );
}

export async function clearPerplexitySiteDataIfNeeded(
  targetUrl: string,
  log: (msg: string) => void = sendLog,
): Promise<void> {
  if (detectProvider(targetUrl) !== 'perplexity') return;
  const providerLabel = getProviderLabel(targetUrl);
  try {
    if (await hasPerplexityReusableSiteCookie()) {
      log(`🔐 ${providerLabel} session or security clearance detected — keep cookies/storage`);
      return;
    }
    const workerSession = session.fromPartition('persist:gemini');
    await workerSession.clearStorageData({
      origin: PROVIDER_URLS.perplexity.replace(/\/$/, ''),
      storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'filesystem'],
    });
    log(`🧹 Cleared ${providerLabel} cookies/storage`);
  } catch (err: unknown) {
    log(`⚠️ Failed to clear ${providerLabel} site data: ${(err as Error).message}`);
  }
}

export function maskToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 8) return '********';
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

export function getAssetPath(filename: string): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'assets', filename);
  }
  return path.join(__dirname, '../../assets', filename);
}
