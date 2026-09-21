import { ipcMain, app, shell } from 'electron';
import * as fs from 'node:fs/promises';
import { IPC, isByokTargetUrl } from '../../shared/types';
import type { CaptureSettings, QuickExportSettings, HiddenSources, HotkeyBindResult, SecretScope, SecretTarget } from '../../shared/types';
import { isThemePreference } from '../../shared/themes';
import { getProviderLabel } from '../providers';
import {
  config,
  saveConfig,
  clearStoredSecret,
  getHiddenSources,
  normalizePromptPreferences,
  normalizeCaptureSettings,
  normalizeQuickExport,
  normalizeHiddenSources,
  normalizeNotifyEvents,
} from '../config';
import type { Config } from '../config';
import { sendLog, normalizeAiUrl, applyLaunchAtStartup, relaunchApp } from '../helpers';
import { getLogDir } from '../logFile';
import { getMetricsSnapshot, resetMetrics } from '../metrics';
import { getFlowMetricsSnapshot, resetFlowMetrics } from '../flowMetrics';
import { getConversationTokenStats } from '../conversationTokenStats';
import { loadLanguageData, setLangCache, setEnCache } from '../i18n';
import { requestFactoryReset } from '../factoryReset';
import { getSecretHealth, isSecretEncryptionAvailable } from '../secretHealth';
import { clearAuthRecord } from '../mcp/mcpTokenStore';
import { getMcpRegistry } from '../mcp';
import { setDataKey } from '../dataKeyStore';
import { flushPendingTempChatResult, isTempChatMode, setTempChatMode } from '../tempChat';
import { getWorkerWin } from '../windows';
import { llmLane } from '../flow/lanes';
import { setHotkeyPaused, wouldCollide } from '../hotkey';
import { normalizeShortcuts } from '../configNormalizers';
import { isRegisterableAccelerator } from '../../shared/shortcuts';
import type { ShortcutOverride } from '../../shared/shortcuts';
import { quickExportAccelerator } from '../hotkeyBinding';
import { buildSettingsSnapshot } from './context';
import type { IpcContext } from './context';

export function applyImportedConfigLiveEffects(importedConfig: Config, ctx: IpcContext): void {
  ctx.bindHotkey();
  ctx.bindQuickExportHotkey();
  applyLaunchAtStartup(importedConfig.launchAtStartup, importedConfig.closeToTray);
  ctx.onTraySettingsChanged?.();
  ctx.onTrayMenuRebuild?.();

  if (!isByokTargetUrl(importedConfig.targetUrl)) {
    const worker = getWorkerWin();
    if (worker && !worker.isDestroyed()) {
      void worker.loadURL(importedConfig.targetUrl).catch(() => {
        sendLog('⚠️ Failed to reload worker after config import');
      });
    }
  }

  void loadLanguageData(importedConfig.locale).then((data) => {
    if (data) setLangCache(data);
  });
  void loadLanguageData('en-US').then((data) => {
    if (data) setEnCache(data);
  });

  // The registry builds its runtime table once, so an imported server list is invisible to it
  // until this runs — the view would keep listing the servers from before the import.
  getMcpRegistry()?.syncWithConfig();

  void ctx.telegramRuntime.syncWithConfig();
  void ctx.lineRuntime.syncWithConfig();
}

const SECRET_SCOPES = new Set<SecretScope>(['telegram', 'line', 'smtp', 'byok', 'mcp', 'dataKey']);

function parseSecretTarget(raw: unknown): SecretTarget | null {
  if (!raw || typeof raw !== 'object') return null;
  const { scope, id, field } = raw as Record<string, unknown>;
  if (typeof scope !== 'string' || !SECRET_SCOPES.has(scope as SecretScope)) return null;
  if (typeof id !== 'string' || typeof field !== 'string') return null;
  return { scope: scope as SecretScope, id, field };
}

/**
 * Deletes a secret the app can no longer read, so a user who does not want to re-enter it can
 * stop being warned about it. Refused while the keychain is merely out of reach: that failure
 * is usually temporary, and honouring it would destroy a secret that was about to come back.
 */
function clearBrokenSecret(raw: unknown): { ok: boolean } {
  const target = parseSecretTarget(raw);
  if (!target) return { ok: false };
  if (!isSecretEncryptionAvailable()) return { ok: false };

  if (target.scope === 'mcp') clearAuthRecord(target.id);
  else if (target.scope === 'dataKey') setDataKey(target.id, '');
  else clearStoredSecret(target.scope, target.id, target.field);

  sendLog(`🗑️ Removed an unreadable stored secret: ${target.scope}.${target.field}`);
  return { ok: true };
}

export function registerSettingsHandlers(ctx: IpcContext): void {
  ipcMain.handle(IPC.GET_SECRET_HEALTH, () => getSecretHealth());
  ipcMain.handle(IPC.DELETE_BROKEN_SECRET, (_event, raw: unknown) => clearBrokenSecret(raw));

  ipcMain.handle(IPC.GET_HOTKEY, () => config.hotkey);
  ipcMain.handle(IPC.UPDATE_HOTKEY, (_event, newHotkey: string): HotkeyBindResult => {
    if (!isRegisterableAccelerator(newHotkey)) return 'taken';
    if (wouldCollide(newHotkey, config.hotkey, config.quickExport.hotkey)) return 'conflict';

    // Bind BEFORE persisting. registerHotkey releases the current accelerator to try the new
    // one, so a combo the OS refuses leaves the app with no hotkey at all — and writing it
    // first meant that dead combo survived every restart.
    const previous = config.hotkey;
    config.hotkey = newHotkey;
    if (!ctx.bindHotkey()) {
      config.hotkey = previous;
      ctx.bindHotkey();
      sendLog(`⌨️  ${newHotkey} was refused by the system — keeping ${previous}`);
      return 'taken';
    }
    saveConfig({ hotkey: newHotkey });
    sendLog(`⌨️  Hotkey updated to: ${newHotkey}`);
    return 'ok';
  });

  ipcMain.handle(IPC.SET_HOTKEY_PAUSED, (_event, paused: boolean) => {
    setHotkeyPaused(paused);
    return true;
  });

  ipcMain.handle(IPC.GET_SHORTCUTS, () => config.shortcuts);
  ipcMain.handle(IPC.UPDATE_SHORTCUTS, (_event, next: Record<string, ShortcutOverride>) => {
    const shortcuts = normalizeShortcuts(next);
    config.shortcuts = shortcuts;
    saveConfig({ shortcuts });
    return shortcuts;
  });

  ipcMain.handle(IPC.GET_HOTKEY_ENABLED, () => config.hotkeyEnabled);
  ipcMain.handle(IPC.SET_HOTKEY_ENABLED, (_event, enabled: boolean): HotkeyBindResult => {
    config.hotkeyEnabled = Boolean(enabled);
    saveConfig({ hotkeyEnabled: config.hotkeyEnabled });
    const ok = ctx.bindHotkey();
    sendLog(`⌨️  Ask hotkey ${config.hotkeyEnabled ? 'enabled' : 'disabled'}`);
    return ok ? 'ok' : 'taken';
  });

  ipcMain.handle(IPC.GET_AI_URL, () => config.targetUrl);
  ipcMain.handle(IPC.UPDATE_AI_URL, (_event, nextUrl: string) => {
    const normalized = normalizeAiUrl(nextUrl);
    config.targetUrl = normalized;
    saveConfig({ targetUrl: normalized });
    if (!isByokTargetUrl(normalized)) {
      void llmLane.runExclusive(async () => {
        const worker = getWorkerWin();
        if (!worker || worker.isDestroyed() || config.targetUrl !== normalized) return;
        await worker.loadURL(normalized).catch(() => undefined);
      });
    }
    sendLog(`🌐 AI target updated: ${getProviderLabel(normalized)}`);
    return true;
  });

  ipcMain.handle(IPC.GET_HIDDEN_SOURCES, (): HiddenSources => getHiddenSources());

  ipcMain.handle(IPC.UPDATE_HIDDEN_SOURCES, (_event, raw: unknown) => {
    const next = normalizeHiddenSources(raw);
    config.hiddenProviders = next.providers;
    config.hiddenByokIds = next.byokIds;
    config.hiddenByokGroupIds = next.byokGroupIds;
    saveConfig({
      hiddenProviders: config.hiddenProviders,
      hiddenByokIds: config.hiddenByokIds,
      hiddenByokGroupIds: config.hiddenByokGroupIds,
    });
    void ctx.telegramRuntime.refreshBotCommands();
    return { ok: true as const };
  });

  ipcMain.handle(IPC.GET_PROMPT_PREFERENCES, () => config.promptPreferences);
  ipcMain.handle(IPC.UPDATE_PROMPT_PREFERENCES, (_event, prefs: unknown) => {
    config.promptPreferences = normalizePromptPreferences(prefs);
    saveConfig({ promptPreferences: config.promptPreferences });
    return true;
  });

  ipcMain.handle(IPC.GET_YOUTUBE_PROMPT, () => config.youtubePrompt);
  ipcMain.handle(IPC.UPDATE_YOUTUBE_PROMPT, (_event, prompt: unknown) => {
    config.youtubePrompt = typeof prompt === 'string' ? prompt : '';
    saveConfig({ youtubePrompt: config.youtubePrompt });
    return true;
  });

  ipcMain.handle(IPC.GET_RESPONSE_TIMEOUT, () => config.responseTimeout);
  ipcMain.handle(IPC.UPDATE_RESPONSE_TIMEOUT, (_event, ms: number) => {
    const clamped = Math.max(15_000, Math.min(300_000, Number(ms)));
    if (!Number.isFinite(clamped)) return false;
    config.responseTimeout = clamped;
    saveConfig({ responseTimeout: clamped });
    return true;
  });

  ipcMain.handle(IPC.GET_SYNC_SYSTEM_LANGUAGE_TO_MODEL, () => config.syncSystemLanguageToModel);
  ipcMain.handle(IPC.UPDATE_SYNC_SYSTEM_LANGUAGE_TO_MODEL, (_event, enabled: boolean) => {
    config.syncSystemLanguageToModel = Boolean(enabled);
    saveConfig({ syncSystemLanguageToModel: config.syncSystemLanguageToModel });
    return true;
  });

  ipcMain.handle(IPC.GET_NOTIFY_ON_COMPLETE, () => config.notifyOnComplete);
  ipcMain.handle(IPC.UPDATE_NOTIFY_ON_COMPLETE, (_event, enabled: boolean) => {
    config.notifyOnComplete = Boolean(enabled);
    saveConfig({ notifyOnComplete: config.notifyOnComplete });
    sendLog(`🔔 Completion notification ${config.notifyOnComplete ? 'enabled' : 'disabled'}`);
    ctx.onTrayMenuRebuild?.();
    return true;
  });

  ipcMain.handle(IPC.GET_NOTIFY_EVENTS, () => config.notifyEvents);
  ipcMain.handle(IPC.UPDATE_NOTIFY_EVENTS, (_event, prefs: unknown) => {
    config.notifyEvents = normalizeNotifyEvents(prefs);
    saveConfig({ notifyEvents: config.notifyEvents });
    return true;
  });

  ipcMain.handle(IPC.GET_LAUNCH_AT_STARTUP, () => config.launchAtStartup);
  ipcMain.handle(IPC.UPDATE_LAUNCH_AT_STARTUP, (_event, enabled: boolean) => {
    config.launchAtStartup = Boolean(enabled);
    saveConfig({ launchAtStartup: config.launchAtStartup });
    applyLaunchAtStartup(config.launchAtStartup, config.closeToTray);
    ctx.onTrayMenuRebuild?.();
    return true;
  });

  ipcMain.handle(IPC.RESET_SETTINGS, async () => {
    await requestFactoryReset();
    sendLog('♻️ Factory reset scheduled — relaunching Yobi');
    relaunchApp('factory reset');
    return buildSettingsSnapshot();
  });

  ipcMain.handle(IPC.OPEN_CONFIG_DIR, async () => {
    const configDir = app.getPath('userData');
    await fs.mkdir(configDir, { recursive: true });
    const error = await shell.openPath(configDir);
    return error === '';
  });

  ipcMain.handle(IPC.OPEN_LOG_DIR, async () => {
    const logDir = getLogDir();
    await fs.mkdir(logDir, { recursive: true });
    const error = await shell.openPath(logDir);
    return error === '';
  });

  ipcMain.handle(IPC.GET_APP_VERSION, () => app.getVersion());
  ipcMain.handle(IPC.GET_UPDATE_SOURCE, () => (process.windowsStore ? 'store' : 'github'));

  ipcMain.handle(IPC.GET_THEME, () => config.theme);
  ipcMain.handle(IPC.UPDATE_THEME, (_event, theme: string) => {
    if (!isThemePreference(theme)) return false;
    saveConfig({ theme });
    return true;
  });

  ipcMain.handle(IPC.GET_LAYOUT_MODE, () => config.layoutMode);
  ipcMain.handle(IPC.UPDATE_LAYOUT_MODE, (_event, layoutMode: string) => {
    const normalized = layoutMode === 'side-by-side' ? 'side-by-side' : 'stacked';
    saveConfig({ layoutMode: normalized });
    return true;
  });
  ipcMain.handle(IPC.GET_SHOW_TOKEN_USAGE, () => config.showTokenUsage);
  ipcMain.handle(IPC.UPDATE_SHOW_TOKEN_USAGE, (_event, show: boolean) => {
    config.showTokenUsage = Boolean(show);
    saveConfig({ showTokenUsage: config.showTokenUsage });
    return true;
  });
  ipcMain.handle(IPC.GET_MARKDOWN_ZOOM, () => config.markdownZoom);
  ipcMain.handle(IPC.UPDATE_MARKDOWN_ZOOM, (_event, zoom: number) => {
    const clamped = Math.min(200, Math.max(70, Math.round(Number(zoom) / 10) * 10));
    saveConfig({ markdownZoom: clamped });
    return true;
  });

  ipcMain.handle(IPC.GET_CAPTURE_SETTINGS, () => config.captureSettings);
  ipcMain.handle(IPC.UPDATE_CAPTURE_SETTINGS, (_event, settings: CaptureSettings) => {
    config.captureSettings = normalizeCaptureSettings(settings);
    saveConfig({ captureSettings: config.captureSettings });
    return true;
  });

  ipcMain.handle(IPC.GET_QUICK_EXPORT, () => config.quickExport);
  ipcMain.handle(IPC.UPDATE_QUICK_EXPORT, (_event, settings: QuickExportSettings): HotkeyBindResult => {
    const next = normalizeQuickExport(settings);
    if (wouldCollide(next.hotkey, config.quickExport.hotkey, config.hotkey)) return 'conflict';

    const previousHotkey = config.quickExport.hotkey;
    const previousAccelerator = quickExportAccelerator(config.quickExport);
    config.quickExport = next;
    if (quickExportAccelerator(next) === previousAccelerator) {
      saveConfig({ quickExport: config.quickExport });
      return 'ok';
    }
    if (!ctx.bindQuickExportHotkey()) {
      // Only the combo goes back — everything else the user just changed still applies.
      config.quickExport = { ...next, hotkey: previousHotkey };
      ctx.bindQuickExportHotkey();
      saveConfig({ quickExport: config.quickExport });
      sendLog(`⌨️  ${next.hotkey} was refused by the system — keeping ${previousHotkey}`);
      return 'taken';
    }
    saveConfig({ quickExport: config.quickExport });
    return 'ok';
  });

  ipcMain.handle(IPC.METRICS_GET, () => getMetricsSnapshot());
  ipcMain.handle(IPC.FLOW_METRICS_GET, () => getFlowMetricsSnapshot());
  ipcMain.handle(IPC.METRICS_CONVERSATION_TOKENS, () => getConversationTokenStats());
  // One button, one mental model: "clear statistics" leaves nothing behind in either store.
  ipcMain.handle(IPC.METRICS_RESET, () => {
    sendLog('📊 Usage statistics cleared');
    resetFlowMetrics();
    return resetMetrics();
  });
  ipcMain.handle(IPC.GET_METRICS_ENABLED, () => config.metricsEnabled);
  ipcMain.handle(IPC.UPDATE_METRICS_ENABLED, (_event, enabled: boolean) => {
    config.metricsEnabled = Boolean(enabled);
    saveConfig({ metricsEnabled: config.metricsEnabled });
    sendLog(`📊 Usage statistics ${config.metricsEnabled ? 'enabled' : 'disabled'}`);
    return true;
  });

  ipcMain.handle(IPC.TEMP_CHAT_GET_MODE, () => {
    setImmediate(flushPendingTempChatResult);
    return isTempChatMode();
  });
  ipcMain.handle(IPC.TEMP_CHAT_SET_MODE, (_event, enabled: boolean) => {
    setTempChatMode(Boolean(enabled));
    return true;
  });

  ipcMain.handle(IPC.GET_CLOSE_TO_TRAY, () => config.closeToTray);
  ipcMain.handle(IPC.UPDATE_CLOSE_TO_TRAY, (_event, enabled: boolean) => {
    config.closeToTray = Boolean(enabled);
    saveConfig({ closeToTray: config.closeToTray });
    applyLaunchAtStartup(config.launchAtStartup, config.closeToTray);
    ctx.onTraySettingsChanged?.();
    return true;
  });

}
