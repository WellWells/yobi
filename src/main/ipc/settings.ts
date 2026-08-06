import { ipcMain, app, shell } from 'electron';
import * as fs from 'node:fs/promises';
import { IPC, isByokTargetUrl } from '../../shared/types';
import type { CaptureSettings, QuickExportSettings, HiddenSources, HotkeyBindResult } from '../../shared/types';
import { isThemePreference } from '../../shared/themes';
import { getProviderLabel } from '../providers';
import {
  config,
  saveConfig,
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
import { getConversationTokenStats } from '../conversationTokenStats';
import { loadLanguageData, setLangCache, setEnCache } from '../i18n';
import { requestFactoryReset } from '../factoryReset';
import { flushPendingTempChatResult, isTempChatMode, setTempChatMode } from '../tempChat';
import { getWorkerWin } from '../windows';
import { llmLane } from '../flow/lanes';
import { setHotkeyPaused, wouldCollide } from '../hotkey';
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

  void ctx.telegramRuntime.syncWithConfig();
  void ctx.lineRuntime.syncWithConfig();
}

export function registerSettingsHandlers(ctx: IpcContext): void {
  ipcMain.handle(IPC.GET_HOTKEY, () => config.hotkey);
  ipcMain.handle(IPC.UPDATE_HOTKEY, (_event, newHotkey: string): HotkeyBindResult => {
    if (wouldCollide(newHotkey, config.hotkey, config.quickExport.hotkey)) return 'conflict';

    saveConfig({ hotkey: newHotkey });
    config.hotkey = newHotkey;
    const ok = ctx.bindHotkey();
    sendLog(`⌨️  Hotkey updated to: ${newHotkey}`);
    return ok ? 'ok' : 'taken';
  });

  ipcMain.handle(IPC.SET_HOTKEY_PAUSED, (_event, paused: boolean) => {
    setHotkeyPaused(paused);
    return true;
  });

  ipcMain.handle(IPC.GET_HOTKEY_ENABLED, () => config.hotkeyEnabled);
  ipcMain.handle(IPC.SET_HOTKEY_ENABLED, (_event, enabled: boolean): HotkeyBindResult => {
    // The combination stays in config while it is off, so switching back on is all it takes.
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
    // Pointing the worker at the new provider only saves the next send a navigation,
    // so it queues behind whatever automation is already driving that window rather
    // than loading a page out from under it — and is skipped once a later pick wins.
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
    config.hiddenDuckaiModelIds = next.duckaiModelIds;
    config.hiddenByokIds = next.byokIds;
    config.hiddenByokGroupIds = next.byokGroupIds;
    saveConfig({
      hiddenProviders: config.hiddenProviders,
      hiddenDuckaiModelIds: config.hiddenDuckaiModelIds,
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
    // Judged only when the combination moves, so a format or ZIP change can never be refused.
    if (wouldCollide(next.hotkey, config.quickExport.hotkey, config.hotkey)) return 'conflict';

    const previous = quickExportAccelerator(config.quickExport);
    config.quickExport = next;
    saveConfig({ quickExport: config.quickExport });
    if (quickExportAccelerator(config.quickExport) === previous) return 'ok';
    return ctx.bindQuickExportHotkey() ? 'ok' : 'taken';
  });

  ipcMain.handle(IPC.METRICS_GET, () => getMetricsSnapshot());
  ipcMain.handle(IPC.METRICS_CONVERSATION_TOKENS, () => getConversationTokenStats());
  ipcMain.handle(IPC.METRICS_RESET, () => {
    sendLog('📊 Usage statistics cleared');
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
