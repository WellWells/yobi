// src/main/ipcHandlers.ts — All IPC handler registrations
import { ipcMain, clipboard, nativeImage, shell, app, dialog } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { IPC, PROVIDER_URLS } from '../shared/types';
import type { MarkdownCaptureRequest, MarkdownCaptureResult, PromptTriggerOptions, CaptureSettings, SettingsSnapshot } from '../shared/types';
import {
  config,
  saveConfig,
  getDefaultConfig,
  getConfigPath,
  importConfigFromJson,
  normalizePromptPreferences,
  normalizeCaptureSettings,
} from './config';
import { detectProvider, getProviderLabel } from './providers';
import { fetchDuckaiModels } from './providers/duckai';
import {
  sendLog,
  sendToRenderer,
  sendWebNotification,
  isHttpUrl,
  normalizeAiUrl,
  createTaskId,
  applyLaunchAtStartup,
  getAssetPath,
} from './helpers';
import {
  listOutputFiles,
  searchOutputFiles,
  buildSafeFileNameFromTitle,
  buildSnapshotFileName,
  getOutputDir,
  getLanguageDir,
  getUniquePath,
} from './files';
import { loadLanguageData, setLangCache, setEnCache } from './i18n';
import { isSingleUrl, fetchAndParse, buildUrlAnalysisPrompt, resolveUrlPrompt } from './urlParser';
import {
  getWorkerWin,
  revealWorkerWindow,
  hideWorkerWindow,
  ensureWorkerWindow,
  showInteractiveWorkerWindow,
  createMainWindow,
} from './windows';
import { captureMarkdownDocument } from './capture';
import {
  buildTelegramSettingsSnapshot,
} from './telegramBridge';
import {
  issuePairingCode,
  revokePairingCode,
  unpairUser,
  normalizePairingState,
  TelegramRuntime,
} from './telegram';
import type { QueueManager } from './queueManager';
import { setHotkeyPaused } from './hotkey';
import type { DuckaiModelInfo } from './providers/duckai';
import type { FlowManager } from './flowManager';
import type { FlowDefinition } from '../shared/types';

// Session-scoped cache: duck.ai model list changes rarely so we fetch once per
// process lifetime and serve subsequent calls from memory, avoiding extra page
// navigations that trigger rate-limit (429) responses from duck.ai.
let duckaiModelsCache: DuckaiModelInfo[] | null = null;

// Idempotent guard — prevents accidental double-registration of ipcMain.on() listeners
let _ipcInitialized = false;

interface SetupDeps {
  queue: QueueManager;
  telegramRuntime: TelegramRuntime;
  telegramSessionId: string;
  getMainWin: () => import('electron').BrowserWindow | null;
  bindHotkey: () => void;
  checkForUpdates: () => Promise<boolean>;
  onTraySettingsChanged?: () => void;
  onTrayMenuRebuild?: () => void;
  onHideToTray?: () => void;
  onQuitApp?: () => void;
  flowManager?: FlowManager;
}

export function setupIpcHandlers(deps: SetupDeps): void {
  if (_ipcInitialized) {
    console.warn('[ipcHandlers] setupIpcHandlers called multiple times — skipping duplicate registration');
    return;
  }
  _ipcInitialized = true;

  const {
    queue,
    telegramRuntime,
    telegramSessionId,
    getMainWin,
    bindHotkey,
    checkForUpdates,
  } = deps;

  async function enqueuePromptFromUi(rawPrompt: string, targetUrl?: string): Promise<string | null> {
    const text = (rawPrompt ?? '').trim();
    if (!text) {
      sendLog('⚠️ Empty UI prompt ignored');
      return null;
    }

    const resolvedTargetUrl = targetUrl?.trim()
      ? normalizeAiUrl(targetUrl)
      : config.targetUrl;

    const langData = await loadLanguageData(config.locale) ?? {};
    const prompt = await resolveUrlPrompt(text, {
      langData: langData as Record<string, string>,
      onLog: sendLog,
      onNotify: (title, body) => sendWebNotification(title, body, 'info'),
    });

    const id = createTaskId();
    queue.enqueue({
      id,
      prompt,
      targetUrl: resolvedTargetUrl,
      source: 'ui',
    });
    sendLog(`[${id}] 🎯 UI prompt queued for ${getProviderLabel(resolvedTargetUrl)}`);
    return id;
  }

  function buildSettingsSnapshot(): SettingsSnapshot {
    return {
      hotkey: config.hotkey,
      geminiUrl: config.targetUrl,
      locale: config.locale,
      theme: config.theme,
      syncSystemLanguageToModel: config.syncSystemLanguageToModel,
      notifyOnComplete: config.notifyOnComplete,
      promptPreferences: config.promptPreferences,
      responseTimeout: config.responseTimeout,
      closeToTray: config.closeToTray,
      launchAtStartup: config.launchAtStartup,
    };
  }

  // Window control
  ipcMain.on(IPC.SHOW_WORKER, async () => {
    if (detectProvider(config.targetUrl) === 'perplexity') {
      await showInteractiveWorkerWindow(config.targetUrl);
      return;
    }
    await ensureWorkerWindow(config.targetUrl);
    revealWorkerWindow();
  });
  ipcMain.on(IPC.HIDE_WORKER, () => hideWorkerWindow());
  ipcMain.handle(IPC.UPDATE_CHECK, () => checkForUpdates());

  // Title bar controls
  ipcMain.on('window:minimize', () => getMainWin()?.minimize());
  ipcMain.on('window:maximize', () => {
    const win = getMainWin();
    if (win?.isMaximized()) win.unmaximize();
    else win?.maximize();
  });
  ipcMain.on('window:close', () => getMainWin()?.close());

  // File list
  ipcMain.handle(IPC.GET_FILE_LIST, () => listOutputFiles());
  ipcMain.handle(IPC.SEARCH_FILE_LIST, (_event, query: string) => searchOutputFiles(query));

  // Path validation — restricts file operations to the output directory.
  // Prevents path traversal attacks from malicious IPC messages.
  async function isAllowedFilePath(filePath: string): Promise<boolean> {
    if (!filePath || typeof filePath !== 'string') return false;
    const resolved = path.resolve(filePath);
    const outputDir = await getOutputDir();
    return resolved.startsWith(outputDir + path.sep) || resolved === outputDir;
  }

  // File content
  ipcMain.handle(IPC.GET_FILE_CONTENT, async (_event, filePath: string) => {
    if (!await isAllowedFilePath(filePath)) return null;
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  });

  ipcMain.handle(IPC.UPDATE_FILE_TITLE, async (_event, filePath: string, newTitle: string) => {
    if (!await isAllowedFilePath(filePath)) return { ok: false, updatedPath: filePath };
    const title = newTitle.trim();
    if (!title) return { ok: false, updatedPath: filePath };
    try {
      const dir = path.dirname(filePath);
      const ext = path.extname(filePath) || '.md';
      const basename = buildSafeFileNameFromTitle(title);
      const targetPath = await getUniquePath(path.join(dir, `${basename}${ext}`), filePath);
      if (targetPath !== filePath) await fs.rename(filePath, targetPath);
      sendToRenderer(IPC.FILE_LIST, await listOutputFiles());
      return { ok: true, updatedPath: targetPath };
    } catch {
      return { ok: false, updatedPath: filePath };
    }
  });

  ipcMain.handle(IPC.UPDATE_FILE_H1, async (_event, filePath: string, newTitle: string) => {
    if (!await isAllowedFilePath(filePath)) return false;
    const title = newTitle.trim();
    if (!title) return false;
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const firstLine = lines[0]?.trim() ?? '';
      if (/^#\s+/.test(firstLine)) {
        lines[0] = `# ${title}`;
      } else {
        lines.unshift(`# ${title}`, '');
      }
      await fs.writeFile(filePath, lines.join('\n'), 'utf-8');
      sendToRenderer(IPC.FILE_LIST, await listOutputFiles());
      return true;
    } catch {
      return false;
    }
  });

  // Delete file
  ipcMain.handle(IPC.DELETE_FILE, async (_event, filePath: string) => {
    if (!await isAllowedFilePath(filePath)) return false;
    try {
      await fs.unlink(filePath);
      sendToRenderer(IPC.FILE_LIST, await listOutputFiles());
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle(IPC.DELETE_ALL_FILES, async () => {
    const files = await listOutputFiles();
    if (files.length === 0) return 0;
    let deleted = 0;
    for (const file of files) {
      try {
        await fs.unlink(file.path);
        deleted += 1;
      } catch {
        // keep deleting remaining files
      }
    }
    sendToRenderer(IPC.FILE_LIST, await listOutputFiles());
    return deleted;
  });

  // Hotkey management
  ipcMain.handle(IPC.GET_HOTKEY, () => config.hotkey);
  ipcMain.handle(IPC.UPDATE_HOTKEY, (_event, newHotkey: string) => {
    saveConfig({ hotkey: newHotkey });
    config.hotkey = newHotkey;
    bindHotkey();
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

  // Telegram settings
  ipcMain.handle(IPC.GET_TELEGRAM_SETTINGS, () => buildTelegramSettingsSnapshot());

  ipcMain.handle(IPC.UPDATE_TELEGRAM_ENABLED, async (_event, enabled: boolean) => {
    config.telegram.enabled = Boolean(enabled);
    saveConfig({ telegram: config.telegram });
    try {
      await telegramRuntime.syncWithConfig();
      sendLog(`Telegram bot ${config.telegram.enabled ? 'enabled' : 'disabled'}`);
      return true;
    } catch (err: unknown) {
      sendLog(`⚠️ Failed to update Telegram runtime: ${(err as Error).message}`);
      return false;
    }
  });

  ipcMain.handle(IPC.UPDATE_TELEGRAM_BOT_TOKEN, async (_event, token: string) => {
    const nextToken = (token ?? '').trim();
    config.telegram.botToken = nextToken;
    saveConfig({ telegram: config.telegram });
    if (!config.telegram.enabled) {
      sendLog(`Telegram bot token ${nextToken ? 'updated' : 'cleared'}`);
      return { ok: true as const };
    }
    try {
      await telegramRuntime.syncWithConfig();
      sendLog('Telegram bot token updated');
      return { ok: true as const };
    } catch (err: unknown) {
      const message = (err as Error).message;
      sendLog(`⚠️ Telegram token update failed: ${message}`);
      return { ok: false as const, message };
    }
  });

  ipcMain.handle(IPC.UPDATE_TELEGRAM_ALLOW_GROUP_COMMANDS, async (_event, enabled: boolean) => {
    config.telegram.allowGroupCommands = Boolean(enabled);
    saveConfig({ telegram: config.telegram });
    try {
      await telegramRuntime.syncWithConfig();
      return true;
    } catch (err: unknown) {
      sendLog(`⚠️ Failed to update Telegram group setting: ${(err as Error).message}`);
      return false;
    }
  });

  ipcMain.handle(IPC.UPDATE_TELEGRAM_DEFAULT_REPLY_MODE, (_event, mode: 'markdown' | 'png' | 'webp' | 'pdf') => {
    if (mode !== 'markdown' && mode !== 'png' && mode !== 'webp' && mode !== 'pdf') return false;
    config.telegram.defaultReplyMode = mode;
    saveConfig({ telegram: config.telegram });
    return true;
  });

  ipcMain.handle(IPC.UPDATE_TELEGRAM_ADMIN_USERS, (_event, userIds: number[]) => {
    const pairedUserIds = new Set(config.telegram.pairing.pairedUsers.map((item) => item.userId));
    const normalized = Array.isArray(userIds)
      ? [...new Set(
        userIds
          .map((value) => Number(value))
          .filter((userId) => Number.isFinite(userId) && userId > 0 && pairedUserIds.has(userId)),
      )]
      : [];
    config.telegram.adminUserIds = normalized;
    saveConfig({ telegram: config.telegram });
    return true;
  });

  ipcMain.handle(IPC.GENERATE_TELEGRAM_PAIRING_CODE, () => {
    const issued = issuePairingCode(config.telegram.pairing, telegramSessionId);
    config.telegram.pairing = issued.nextState;
    saveConfig({ telegram: config.telegram });
    sendLog(`Telegram pairing code generated (expires at ${issued.expiresAt})`);
    return { code: issued.code, expiresAt: issued.expiresAt };
  });

  ipcMain.handle(IPC.REVOKE_TELEGRAM_PAIRING_CODE, (_event, code: string) => {
    config.telegram.pairing = revokePairingCode(config.telegram.pairing, code);
    saveConfig({ telegram: config.telegram });
    return true;
  });

  ipcMain.handle(IPC.UNPAIR_TELEGRAM_USER, (_event, userId: number) => {
    const numericUserId = Number(userId);
    if (!Number.isFinite(numericUserId) || numericUserId <= 0) return false;
    config.telegram.pairing = unpairUser(config.telegram.pairing, numericUserId);
    config.telegram.adminUserIds = config.telegram.adminUserIds.filter((id) => id !== numericUserId);
    saveConfig({ telegram: config.telegram });
    return true;
  });

  // Language list
  ipcMain.handle(IPC.GET_LANGUAGE_LIST, async () => {
    const langDir = getLanguageDir();
    try {
      const files = await fs.readdir(langDir);
      return files.filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
    } catch {
      return ['en-US', 'zh-TW'];
    }
  });

  // Language content
  ipcMain.handle(IPC.GET_CURRENT_LOCALE, () => ({
    locale: config.locale,
    setByUser: config.localeSetByUser,
  }));
  ipcMain.handle(IPC.GET_LANGUAGE_CONTENT, (_event, lang: string) => loadLanguageData(lang));

  // User-initiated locale change — marks locale as explicitly chosen by user
  ipcMain.handle(IPC.SET_CURRENT_LOCALE, async (_event, lang: string) => {
    const nextLocale = (lang ?? '').trim();
    if (!nextLocale) return false;
    config.locale = nextLocale;
    config.localeSetByUser = true;
    saveConfig({ locale: nextLocale, localeSetByUser: true });
    void loadLanguageData(nextLocale).then((data) => {
      if (!data) return;
      setLangCache(data);
      deps.onTrayMenuRebuild?.();
      void telegramRuntime.syncWithConfig();
    });
    return true;
  });

  // Auto-detected locale save — stores detected locale without marking as user-set
  ipcMain.handle(IPC.SET_LOCALE_AUTO, async (_event, lang: string) => {
    const nextLocale = (lang ?? '').trim();
    if (!nextLocale) return false;
    config.locale = nextLocale;
    saveConfig({ locale: nextLocale });
    void loadLanguageData(nextLocale).then((data) => {
      if (!data) return;
      setLangCache(data);
      deps.onTrayMenuRebuild?.();
      void telegramRuntime.syncWithConfig();
    });
    return true;
  });

  // Custom Prompt — built from promptPreferences at runtime, not persisted separately
  ipcMain.handle(IPC.GET_CUSTOM_PROMPT, () => '');
  ipcMain.handle(IPC.UPDATE_CUSTOM_PROMPT, () => true);

  ipcMain.handle(IPC.GET_PROMPT_PREFERENCES, () => config.promptPreferences);
  ipcMain.handle(IPC.UPDATE_PROMPT_PREFERENCES, (_event, prefs: unknown) => {
    config.promptPreferences = normalizePromptPreferences(prefs);
    saveConfig({ promptPreferences: config.promptPreferences });
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
    deps.onTrayMenuRebuild?.();
    return true;
  });

  ipcMain.handle(IPC.GET_LAUNCH_AT_STARTUP, () => config.launchAtStartup);
  ipcMain.handle(IPC.UPDATE_LAUNCH_AT_STARTUP, (_event, enabled: boolean) => {
    config.launchAtStartup = Boolean(enabled);
    saveConfig({ launchAtStartup: config.launchAtStartup });
    applyLaunchAtStartup(config.launchAtStartup, config.closeToTray);
    deps.onTrayMenuRebuild?.();
    return true;
  });

  ipcMain.handle(IPC.RESET_SETTINGS, () => {
    const defaults = getDefaultConfig();
    Object.assign(config, defaults);
    saveConfig(defaults);
    bindHotkey();
    const worker = getWorkerWin();
    if (worker && !worker.isDestroyed()) {
      worker.loadURL(config.targetUrl).catch(() => {
        sendLog('⚠️ Failed to reload worker after settings reset');
      });
    }
    void telegramRuntime.syncWithConfig();
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
      const win = getMainWin();
      const result = win && !win.isDestroyed()
        ? await dialog.showSaveDialog(win, { defaultPath })
        : await dialog.showSaveDialog({ defaultPath });
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
      const win = getMainWin();
      const result = win && !win.isDestroyed()
        ? await dialog.showOpenDialog(win, { properties: ['openFile'] })
        : await dialog.showOpenDialog({ properties: ['openFile'] });
      if (result.canceled || result.filePaths.length === 0) return null;
      if (path.extname(result.filePaths[0]).toLowerCase() !== '.json') return null;

      const importedRaw = await fs.readFile(result.filePaths[0], 'utf-8');
      const importedJson = JSON.parse(importedRaw) as unknown;
      const importedConfig = importConfigFromJson(importedJson);
      if (!importedConfig) return null;

      bindHotkey();
      applyLaunchAtStartup(importedConfig.launchAtStartup, importedConfig.closeToTray);
      deps.onTraySettingsChanged?.();
      deps.onTrayMenuRebuild?.();

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

      void telegramRuntime.syncWithConfig();
      sendLog('📥 Config imported');
      return buildSettingsSnapshot();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown import error';
      sendLog(`⚠️ Failed to import config: ${message}`);
      return null;
    }
  });

  // License
  ipcMain.handle(IPC.GET_LICENSE, async () => {
    const licensePath = app.isPackaged
      ? path.join(process.resourcesPath, 'LICENSE')
      : path.join(app.getAppPath(), 'LICENSE');
    try {
      return await fs.readFile(licensePath, 'utf-8');
    } catch {
      return 'MIT License — see LICENSE file.';
    }
  });

  ipcMain.handle(IPC.GET_APP_VERSION, () => app.getVersion());

  // Theme persistence
  ipcMain.handle(IPC.GET_THEME, () => config.theme);
  ipcMain.handle(IPC.UPDATE_THEME, (_event, theme: string) => {
    config.theme = theme;
    saveConfig({ theme });
    return true;
  });

  // UI layout preferences
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

  ipcMain.handle(IPC.GET_APP_ICON_DATA_URL, () => {
    const iconFile = process.platform === 'darwin' ? 'icon-mac.png' : 'icon-win.png';
    const img = nativeImage.createFromPath(getAssetPath(iconFile));
    return img.toDataURL();
  });

  ipcMain.handle(IPC.OPEN_EXTERNAL_URL, async (_event, rawUrl: string) => {
    if (!isHttpUrl(rawUrl)) return false;
    try {
      await shell.openExternal(rawUrl);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle(IPC.CAPTURE_MARKDOWN_IMAGE, async (_event, request: MarkdownCaptureRequest) => {
    try {
      const resultDoc = await captureMarkdownDocument(request);
      const requestedFileName = (request?.options?.fileName ?? '').trim();
      const fileStem = requestedFileName ? buildSafeFileNameFromTitle(requestedFileName) : buildSnapshotFileName();
      if (resultDoc.mode === 'copy') {
        if (resultDoc.ext === 'pdf' || resultDoc.ext === 'webp') {
          const tmpDir = os.tmpdir();
          const tmpPath = path.join(tmpDir, `${fileStem}.${resultDoc.ext}`);
          await fs.writeFile(tmpPath, resultDoc.buffer);

          if (process.platform === 'win32') {
            await new Promise<void>((resolve) => {
              execFile(
                'powershell.exe',
                ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', `Set-Clipboard -Path "${tmpPath}"`],
                () => resolve(),
              );
            });
          } else if (process.platform === 'darwin') {
            clipboard.writeBuffer('public.file-url', Buffer.from(`file://${tmpPath}`, 'utf-8'));
          } else {
            clipboard.writeBuffer('text/uri-list', Buffer.from(`file://${tmpPath}`, 'utf-8'));
          }
          sendLog(`📋 ${resultDoc.ext.toUpperCase()} copied as temp file: ${tmpPath}`);
        } else {
          const image = nativeImage.createFromBuffer(resultDoc.buffer);
          clipboard.writeImage(image);
          sendLog('📋 Image copied to clipboard');
        }
        const result: MarkdownCaptureResult = { ok: true };
        return result;
      }

      const outputDir = await getOutputDir();
      await fs.mkdir(outputDir, { recursive: true });
      const filePath = await getUniquePath(
        path.join(outputDir, `${fileStem}.${resultDoc.ext}`),
        '',
      );
      await fs.writeFile(filePath, resultDoc.buffer);
      sendLog(`🖼️ Snapshot saved: ${path.basename(filePath)}`);
      const result: MarkdownCaptureResult = { ok: true, filePath };
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'capture failed';
      sendLog(`❌ Failed to capture snapshot: ${message}`);
      const result: MarkdownCaptureResult = { ok: false, error: message };
      return result;
    }
  });

  // Trigger prompt from UI directly
  ipcMain.on(IPC.TRIGGER_PROMPT, (_event, prompt: string) => {
    void enqueuePromptFromUi(prompt, config.targetUrl);
  });

  ipcMain.handle(IPC.TRIGGER_PROMPT_WITH_OPTIONS, (_event, options: PromptTriggerOptions) =>
    enqueuePromptFromUi(options?.prompt ?? '', options?.targetUrl),
  );

  ipcMain.handle(IPC.CANCEL_QUEUE_TASK, (_event, taskId: string) => {
    const normalizedTaskId = (taskId ?? '').trim();
    if (!normalizedTaskId) return false;
    const cancelled = queue.cancel(normalizedTaskId);
    if (cancelled) sendLog(`[${normalizedTaskId}] 🛑 Queue item cancelled`);
    return cancelled;
  });

  ipcMain.handle(IPC.COPY_TEXT_TO_CLIPBOARD, (_event, text: string) => {
    clipboard.writeText(text ?? '');
    return true;
  });

  // Reveal file in system Explorer / Finder
  ipcMain.handle(IPC.SHOW_IN_FOLDER, (_event, filePath: string) => shell.showItemInFolder(filePath));
  ipcMain.handle(IPC.OPEN_PATH, async (_event, filePath: string) => {
    const error = await shell.openPath(filePath);
    return error === '';
  });

  // Tray / window close behavior
  ipcMain.handle(IPC.GET_CLOSE_TO_TRAY, () => config.closeToTray);
  ipcMain.handle(IPC.UPDATE_CLOSE_TO_TRAY, (_event, enabled: boolean) => {
    config.closeToTray = Boolean(enabled);
    saveConfig({ closeToTray: config.closeToTray });
    // Update login item hidden-mode arg to match new closeToTray state
    applyLaunchAtStartup(config.launchAtStartup, config.closeToTray);
    deps.onTraySettingsChanged?.();
    return true;
  });

  ipcMain.handle(IPC.GET_AUTO_SHOW_TRAY, () => config.autoShowTray);
  ipcMain.handle(IPC.UPDATE_AUTO_SHOW_TRAY, (_event, enabled: boolean) => {
    config.autoShowTray = Boolean(enabled);
    saveConfig({ autoShowTray: config.autoShowTray });
    deps.onTraySettingsChanged?.();
    return true;
  });

  // Close dialog response from renderer
  ipcMain.on(IPC.RESPOND_CLOSE_DIALOG, (_event, action: 'quit' | 'hide', remember: boolean) => {
    if (remember) {
      const hideToTray = action === 'hide';
      config.closeActionDecided = true;
      config.closeToTray = hideToTray;
      saveConfig({ closeActionDecided: true, closeToTray: hideToTray });
      sendToRenderer(IPC.CLOSE_TO_TRAY_CHANGED, hideToTray);
      deps.onTraySettingsChanged?.();
    }
    if (action === 'hide') {
      deps.onHideToTray?.();
    } else {
      deps.onQuitApp?.();
    }
  });

  // Duck AI — dynamic model list fetch (cached per process lifetime)
  ipcMain.handle(IPC.DUCKAI_FETCH_MODELS, async () => {
    if (duckaiModelsCache !== null) return duckaiModelsCache;
    try {
      const win = await ensureWorkerWindow(PROVIDER_URLS.duckai);
      if (!win) return [];
      duckaiModelsCache = await fetchDuckaiModels(win);
      return duckaiModelsCache;
    } catch (err: unknown) {
      sendLog(`⚠️ Duck AI model fetch failed: ${(err as Error).message}`);
      return [];
    }
  });

  // ── AgentFlow (Flow Automation) ───────────────────────────────────────────
  const { flowManager } = deps;

  ipcMain.handle(IPC.FLOW_GET_ALL, () => {
    return flowManager?.getAll() ?? [];
  });

  ipcMain.handle(IPC.FLOW_SAVE, async (_event, flow: FlowDefinition) => {
    if (!flowManager) return null;
    return flowManager.save(flow);
  });

  ipcMain.handle(IPC.FLOW_DELETE, async (_event, flowId: string) => {
    if (!flowManager) return false;
    return flowManager.delete(flowId);
  });

  ipcMain.handle(IPC.FLOW_DUPLICATE, async (_event, flowId: string) => {
    if (!flowManager) return null;
    return flowManager.duplicate(flowId);
  });

  ipcMain.handle(IPC.FLOW_MOVE, async (_event, flowId: string, direction: 'up' | 'down') => {
    if (!flowManager) return [];
    return flowManager.move(flowId, direction);
  });

  ipcMain.handle(IPC.FLOW_EXECUTE, async (_event, flowId: string) => {
    if (!flowManager) return { flowId, success: false, outputs: {}, error: 'FlowManager not available', completedSteps: 0, totalSteps: 0, completedAt: new Date().toISOString() };
    return flowManager.queueExecution(flowId);
  });

  ipcMain.handle(IPC.FLOW_EXPORT, async (_event, flow: FlowDefinition) => {
    try {
      const safeName = (flow.name ?? 'flow').replace(/[^\w\-. ]/g, '_').trim() || 'flow';
      const defaultPath = path.join(app.getPath('documents'), `${safeName}.json`);
      const win = getMainWin();
      const result = win && !win.isDestroyed()
        ? await dialog.showSaveDialog(win, {
          defaultPath,
          filters: [{ name: 'JSON', extensions: ['json'] }],
        })
        : await dialog.showSaveDialog({
          defaultPath,
          filters: [{ name: 'JSON', extensions: ['json'] }],
        });
      if (result.canceled || !result.filePath) return false;
      const payload = { type: 'agentflow-export', version: 1, flow };
      await fs.writeFile(result.filePath, JSON.stringify(payload, null, 2), 'utf-8');
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown export error';
      sendLog(`⚠️ Failed to export flow: ${message}`);
      return false;
    }
  });

  // ── RSS Checkpoint ─────────────────────────────────────────────────────────
  ipcMain.handle(IPC.RSS_HAS_CHECKPOINT, async (_event, stepId: string) => {
    const dir = app.isPackaged ? app.getPath('userData') : path.resolve('.');
    const filePath = path.join(dir, 'flow-checkpoints', `rss-${stepId}.json`);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle(IPC.RSS_CLEAR_CHECKPOINT, async (_event, stepId: string) => {
    const dir = app.isPackaged ? app.getPath('userData') : path.resolve('.');
    const filePath = path.join(dir, 'flow-checkpoints', `rss-${stepId}.json`);
    try {
      await fs.unlink(filePath);
      sendLog(`📡 [AgentFlow] RSS checkpoint cleared for step: ${stepId}`);
      return true;
    } catch {
      return false;
    }
  });

  // ── Scraper Checkpoint ─────────────────────────────────────────────────────
  ipcMain.handle(IPC.SCRAPER_HAS_CHECKPOINT, async (_event, stepId: string) => {
    const dir = app.isPackaged ? app.getPath('userData') : path.resolve('.');
    const filePath = path.join(dir, 'flow-checkpoints', `scraper-${stepId}.json`);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle(IPC.SCRAPER_CLEAR_CHECKPOINT, async (_event, stepId: string) => {
    const dir = app.isPackaged ? app.getPath('userData') : path.resolve('.');
    const filePath = path.join(dir, 'flow-checkpoints', `scraper-${stepId}.json`);
    try {
      await fs.unlink(filePath);
      sendLog(`📡 [AgentFlow] Scraper checkpoint cleared for step: ${stepId}`);
      return true;
    } catch {
      return false;
    }
  });
}
