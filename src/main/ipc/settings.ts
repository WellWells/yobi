import { ipcMain, app, shell } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { IPC } from '../../shared/types';
import type { CaptureSettings } from '../../shared/types';
import {
  config,
  saveConfig,
  getDefaultConfig,
  getConfigPath,
  importConfigFromJson,
  normalizePromptPreferences,
  normalizeCaptureSettings,
} from '../config';
import { sendLog, normalizeAiUrl, applyLaunchAtStartup } from '../helpers';
import { loadLanguageData, setLangCache, setEnCache } from '../i18n';
import { getWorkerWin } from '../windows';
import { setHotkeyPaused } from '../hotkey';
import {
  buildSettingsSnapshot,
  showOpenDialogForWin,
  showSaveDialogForWin,
} from './context';
import type { IpcContext } from './context';

export function registerSettingsHandlers(ctx: IpcContext): void {
  ipcMain.handle(IPC.GET_HOTKEY, () => config.hotkey);
  ipcMain.handle(IPC.UPDATE_HOTKEY, (_event, newHotkey: string) => {
    saveConfig({ hotkey: newHotkey });
    config.hotkey = newHotkey;
    ctx.bindHotkey();
    sendLog(`⌨️  Hotkey updated to: ${newHotkey}`);
    return true;
  });

  ipcMain.handle(IPC.SET_HOTKEY_PAUSED, (_event, paused: boolean) => {
    setHotkeyPaused(paused);
    return true;
  });

  ipcMain.handle(IPC.GET_AI_URL, () => config.targetUrl);
  ipcMain.handle(IPC.UPDATE_AI_URL, async (_event, nextUrl: string) => {
    const normalized = normalizeAiUrl(nextUrl);
    config.targetUrl = normalized;
    saveConfig({ targetUrl: normalized });
    const worker = getWorkerWin();
    if (worker && !worker.isDestroyed()) await worker.loadURL(normalized);
    sendLog(`🌐 AI target updated: ${normalized}`);
    return true;
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

  ipcMain.handle(IPC.GET_LAUNCH_AT_STARTUP, () => config.launchAtStartup);
  ipcMain.handle(IPC.UPDATE_LAUNCH_AT_STARTUP, (_event, enabled: boolean) => {
    config.launchAtStartup = Boolean(enabled);
    saveConfig({ launchAtStartup: config.launchAtStartup });
    applyLaunchAtStartup(config.launchAtStartup, config.closeToTray);
    ctx.onTrayMenuRebuild?.();
    return true;
  });

  ipcMain.handle(IPC.RESET_SETTINGS, () => {
    const defaults = getDefaultConfig();
    Object.assign(config, defaults);
    saveConfig(defaults);
    ctx.bindHotkey();
    const worker = getWorkerWin();
    if (worker && !worker.isDestroyed()) {
      worker.loadURL(config.targetUrl).catch(() => {
        sendLog('⚠️ Failed to reload worker after settings reset');
      });
    }
    void ctx.telegramRuntime.syncWithConfig();
    sendLog('♻️ Settings restored to defaults');
    return buildSettingsSnapshot();
  });

  ipcMain.handle(IPC.OPEN_CONFIG_DIR, async () => {
    const configDir = app.getPath('userData');
    await fs.mkdir(configDir, { recursive: true });
    const error = await shell.openPath(configDir);
    return error === '';
  });

  ipcMain.handle(IPC.EXPORT_CONFIG, async () => {
    try {
      const defaultPath = path.join(app.getPath('documents'), 'config.json');
      const result = await showSaveDialogForWin(ctx.getMainWin(), { defaultPath });
      if (result.canceled || !result.filePath) return false;
      const sourcePath = getConfigPath();
      await fs.copyFile(sourcePath, result.filePath);
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown export error';
      sendLog(`⚠️ Failed to export config: ${message}`);
      return false;
    }
  });

  ipcMain.handle(IPC.IMPORT_CONFIG, async () => {
    try {
      const result = await showOpenDialogForWin(ctx.getMainWin(), { properties: ['openFile'] });
      if (result.canceled || result.filePaths.length === 0) return null;
      if (path.extname(result.filePaths[0]).toLowerCase() !== '.json') return null;

      const importedRaw = await fs.readFile(result.filePaths[0], 'utf-8');
      const importedJson = JSON.parse(importedRaw) as unknown;
      const importedConfig = importConfigFromJson(importedJson);
      if (!importedConfig) return null;

      ctx.bindHotkey();
      applyLaunchAtStartup(importedConfig.launchAtStartup, importedConfig.closeToTray);
      ctx.onTraySettingsChanged?.();
      ctx.onTrayMenuRebuild?.();

      const worker = getWorkerWin();
      if (worker && !worker.isDestroyed()) {
        void worker.loadURL(importedConfig.targetUrl).catch(() => {
          sendLog('⚠️ Failed to reload worker after config import');
        });
      }

      void loadLanguageData(importedConfig.locale).then((data) => {
        if (!data) return;
        setLangCache(data);
      });
      void loadLanguageData('en-US').then((data) => {
        if (!data) return;
        setEnCache(data);
      });

      void ctx.telegramRuntime.syncWithConfig();
      sendLog('📥 Config imported');
      return buildSettingsSnapshot();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown import error';
      sendLog(`⚠️ Failed to import config: ${message}`);
      return null;
    }
  });

  ipcMain.handle(IPC.GET_APP_VERSION, () => app.getVersion());

  ipcMain.handle(IPC.GET_THEME, () => config.theme);
  ipcMain.handle(IPC.UPDATE_THEME, (_event, theme: string) => {
    config.theme = theme;
    saveConfig({ theme });
    return true;
  });

  ipcMain.handle(IPC.GET_LAYOUT_MODE, () => config.layoutMode);
  ipcMain.handle(IPC.UPDATE_LAYOUT_MODE, (_event, layoutMode: string) => {
    const normalized = layoutMode === 'side-by-side' ? 'side-by-side' : 'stacked';
    saveConfig({ layoutMode: normalized });
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

  ipcMain.handle(IPC.GET_CLOSE_TO_TRAY, () => config.closeToTray);
  ipcMain.handle(IPC.UPDATE_CLOSE_TO_TRAY, (_event, enabled: boolean) => {
    config.closeToTray = Boolean(enabled);
    saveConfig({ closeToTray: config.closeToTray });
    applyLaunchAtStartup(config.launchAtStartup, config.closeToTray);
    ctx.onTraySettingsChanged?.();
    return true;
  });

}
