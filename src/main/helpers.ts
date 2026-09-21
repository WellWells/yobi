import { app, Notification, session } from 'electron';
import type { BrowserWindow } from 'electron';
import * as path from 'node:path';
import type { UiNotificationPayload, WorkerAttention } from '../shared/types';
import { IPC, PROVIDER_URLS } from '../shared/types';
import { detectProvider, getProviderLabel } from './providers';
import { isPerplexitySessionCookie } from './providers/perplexity';
import { appendLogLine, fileStamp } from './logFile';

let _mainWin: BrowserWindow | null = null;
let _notifyEnabled = true;
let _workerReveal: (() => void) | null = null;
let _secretSettingsReveal: (() => void) | null = null;
let _workerAttention: WorkerAttention = 'idle';

export function setMainWindow(win: BrowserWindow | null): void {
  _mainWin = win;
}

export function setWorkerReveal(fn: () => void): void {
  _workerReveal = fn;
}

export function setSecretSettingsReveal(fn: () => void): void {
  _secretSettingsReveal = fn;
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
    // Electron 44 removed openAsHidden — it only ever worked on macOS 12 and below, so
    // launching hidden is no longer expressible there. openAtLogin still applies.
    app.setLoginItemSettings({ openAtLogin: enabled });
  }
}

export function relaunchApp(reason = 'restart requested'): void {
  sendLog(`🔄 Relaunching Yobi (${reason})...`);
  app.relaunch();
  setTimeout(() => app.quit(), 600);
}

export function sendLog(msg: string): void {
  const now = new Date();
  const time = now.toLocaleTimeString('en-GB', { hour12: false });
  const line = `[${time}] ${msg}`;
  console.log(line);
  sendToRenderer(IPC.LOG, line);
  appendLogLine(`[${fileStamp(now)}] ${msg}`);
}

export function sendToRenderer(channel: string, ...args: unknown[]): void {
  if (_mainWin && !_mainWin.isDestroyed()) {
    _mainWin.webContents.send(channel, ...args);
  }
}

export function getMainWindow(): BrowserWindow | null {
  return _mainWin !== null && !_mainWin.isDestroyed() ? _mainWin : null;
}

export function isMainWindowAlive(): boolean {
  return _mainWin !== null && !_mainWin.isDestroyed();
}

export function setWorkerAttention(state: WorkerAttention): void {
  _workerAttention = state;
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
  emitNotification(title, body, level, action);
}

/**
 * Ignores the "notify me" preference on purpose: that switch is about task chatter, and a
 * secret the app can no longer decrypt is not chatter — silencing it is how a dead bot token
 * goes unnoticed for weeks.
 */
export function sendSecurityNotification(
  title: string,
  body: string,
  action?: UiNotificationPayload['action'],
): void {
  emitNotification(title, body, 'error', action);
}

/**
 * How long the native notification gets to report `show` before the in-app toast steps in.
 * Electron emits `show` only after the OS accepted the notice (WinRT `ToastNotifier::Show`,
 * `UNUserNotificationCenter addNotificationRequest`, `notify_notification_show`) and `failed`
 * when it did not; measured at ~10 ms on Windows, so silence this long means it was dropped.
 * Exported for the test suite.
 */
export const NATIVE_SHOW_GRACE_MS = 1_500;

/** The two verdicts a native notification can give. Exported for the test suite. */
export interface NativeDeliveryEvents {
  once(event: 'show', listener: () => void): unknown;
  once(event: 'failed', listener: (event: unknown, error: string) => void): unknown;
}

/**
 * Calls `onUndelivered` exactly once if the native notification never reaches the user:
 * the OS reported `failed`, or stayed silent past the grace period. A verdict that arrives
 * after that is ignored, so the user never gets the same notice twice.
 * Exported for the test suite.
 */
export function watchNativeDelivery(
  notification: NativeDeliveryEvents,
  onUndelivered: (reason: string) => void,
  graceMs: number = NATIVE_SHOW_GRACE_MS,
): void {
  let settled = false;
  const settle = (reason: string | null): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (reason !== null) onUndelivered(reason);
  };
  const timer = setTimeout(() => settle(`no show within ${graceMs} ms`), graceMs);
  notification.once('show', () => settle(null));
  notification.once('failed', (_event, error) => settle(`failed: ${error}`));
}

/**
 * Native first; the in-app toast exists for the notice the OS could not show. The two are
 * never sent together: a banner is the right channel while the window is hidden, and the
 * toast covers a platform without notifications or a Mac that has not allowed them yet.
 */
function emitNotification(
  title: string,
  body: string,
  level: UiNotificationPayload['level'],
  action?: UiNotificationPayload['action'],
): void {
  const showInApp = (): void => {
    sendToRenderer(IPC.UI_NOTIFICATION, { title, body, level, action });
  };
  if (!Notification.isSupported()) {
    showInApp();
    return;
  }
  const notification = new Notification({
    title,
    body,
    urgency: level === 'error' ? 'critical' : 'normal',
    silent: false,
  });
  if (action?.id === 'open-worker-window' && _workerReveal) {
    notification.on('click', _workerReveal);
  }
  if (action?.id === 'open-secret-settings' && _secretSettingsReveal) {
    notification.on('click', _secretSettingsReveal);
  }
  watchNativeDelivery(notification, (reason) => {
    appendLogLine(`[${fileStamp(new Date())}] Native notification not shown (${reason}); falling back to the in-app toast`);
    showInApp();
  });
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
      isPerplexitySessionCookie(cookie) ||
      (cookie.name === 'cf_clearance' && !isExpiredCookie(cookie.expirationDate)),
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

const MAX_REQUESTER_NAME_CHARS = 64;

export function sanitizeRequesterName(raw: string | undefined): string {
  if (!raw) return '';
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  const chars = Array.from(collapsed);
  return chars.length <= MAX_REQUESTER_NAME_CHARS
    ? collapsed
    : chars.slice(0, MAX_REQUESTER_NAME_CHARS).join('');
}

export function getAssetPath(filename: string): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'assets', filename);
  }
  return path.join(__dirname, '../../assets', filename);
}
