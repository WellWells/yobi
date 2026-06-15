import { ipcMain, nativeImage, shell } from 'electron';
import * as fs from 'node:fs/promises';
import { IPC, PROVIDER_URLS } from '../../shared/types';
import type { PromptTriggerOptions, SelectPathRequest, SelectPathResult } from '../../shared/types';
import { config, saveConfig } from '../config';
import { getProviderLabel } from '../providers';
import { fetchDuckaiModels } from '../providers/duckai';
import {
  sendLog,
  sendToRenderer,
  sendWebNotification,
  isHttpUrl,
  normalizeAiUrl,
  createTaskId,
  getAssetPath,
} from '../helpers';
import { loadLanguageData } from '../i18n';
import { resolveUrlPrompt } from '../urlParser';
import {
  revealWorkerWindow,
  hideWorkerWindow,
  ensureWorkerWindow,
} from '../windows';
import type { QueueManager } from '../queueManager';
import type { TelegramRuntime } from '../telegram';
import type { DuckaiModelInfo } from '../providers/duckai';
import type { FlowManager } from '../flow';
import type { IpcContext } from './context';
import { showOpenDialogForWin } from './context';
import { registerFileHandlers } from './files';
import { registerTelegramHandlers } from './telegram';
import { registerLocaleHandlers } from './locale';
import { registerSettingsHandlers } from './settings';
import { registerFlowHandlers } from './flow';
import { registerAccountHandlers } from './account';
import { registerEmailHandlers } from './email';

let duckaiModelsCache: DuckaiModelInfo[] | null = null;

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

  const { queue, getMainWin, checkForUpdates } = deps;
  const ctx: IpcContext = deps;

  async function enqueuePromptFromUi(rawPrompt: string, targetUrl?: string, attachments?: string[]): Promise<string | null> {
    const text = (rawPrompt ?? '').trim();
    if (!text) {
      sendLog('⚠️ Empty UI prompt ignored');
      return null;
    }

    const resolvedTargetUrl = targetUrl?.trim()
      ? normalizeAiUrl(targetUrl)
      : config.targetUrl;

    const langData = await loadLanguageData(config.locale) ?? {};
    const resolved = await resolveUrlPrompt(text, {
      langData: langData as Record<string, string>,
      youtubePrompt: config.youtubePrompt,
      onLog: sendLog,
      onNotify: (title, body) => sendWebNotification(title, body, 'info'),
    });
    const finalTargetUrl = resolved.forceProviderUrl ?? resolvedTargetUrl;

    const id = createTaskId();
    queue.enqueue({
      id,
      prompt: resolved.prompt,
      targetUrl: finalTargetUrl,
      title: resolved.title,
      source: 'ui',
      attachments,
    });
    sendLog(`[${id}] 🎯 UI prompt queued for ${getProviderLabel(finalTargetUrl)}`);
    return id;
  }

  ipcMain.on(IPC.SHOW_WORKER, async () => {
    await ensureWorkerWindow(config.targetUrl);
    revealWorkerWindow();
  });
  ipcMain.on(IPC.HIDE_WORKER, () => hideWorkerWindow());
  ipcMain.handle(IPC.UPDATE_CHECK, () => checkForUpdates());

  ipcMain.on(IPC.WINDOW_MINIMIZE, () => getMainWin()?.minimize());
  ipcMain.on(IPC.WINDOW_MAXIMIZE, () => {
    const win = getMainWin();
    if (win?.isMaximized()) win.unmaximize();
    else win?.maximize();
  });
  ipcMain.on(IPC.WINDOW_CLOSE, () => getMainWin()?.close());

  ipcMain.handle(IPC.GET_APP_ICON_DATA_URL, () => {
    const iconFile = process.platform === 'darwin' ? 'icon-mac.png' : 'icon-win.png';
    const img = nativeImage.createFromPath(getAssetPath(iconFile));
    return img.toDataURL();
  });

  ipcMain.handle(IPC.SELECT_PATH, async (_event, req: SelectPathRequest = {}): Promise<SelectPathResult | null> => {
    const mode = req.mode === 'folder' ? 'folder' : 'file';
    const result = await showOpenDialogForWin(getMainWin(), {
      properties: mode === 'folder' ? ['openDirectory'] : ['openFile'],
      filters: req.filters,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    if (req.readContent && mode === 'file') {
      try {
        return { path: filePath, content: await fs.readFile(filePath, 'utf-8') };
      } catch {
        return { path: filePath };
      }
    }
    return { path: filePath };
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

  ipcMain.handle(IPC.OPEN_THIRD_PARTY_LICENSES, async () => {
    const error = await shell.openPath(getAssetPath('../THIRD-PARTY-LICENSES.txt'));
    if (error) {
      sendLog(`⚠️ Could not open third-party licenses: ${error}`);
      return false;
    }
    return true;
  });

  ipcMain.on(IPC.TRIGGER_PROMPT, (_event, prompt: string) => {
    void enqueuePromptFromUi(prompt, config.targetUrl);
  });

  ipcMain.handle(IPC.TRIGGER_PROMPT_WITH_OPTIONS, (_event, options: PromptTriggerOptions) =>
    enqueuePromptFromUi(options?.prompt ?? '', options?.targetUrl, options?.attachments),
  );

  ipcMain.handle(IPC.CANCEL_QUEUE_TASK, (_event, taskId: string) => {
    const normalizedTaskId = (taskId ?? '').trim();
    if (!normalizedTaskId) return false;
    const cancelled = queue.cancel(normalizedTaskId);
    if (cancelled) sendLog(`[${normalizedTaskId}] 🛑 Queue item cancelled`);
    return cancelled;
  });

  ipcMain.handle(IPC.FORCE_SKIP_ACTIVE_TASK, () => {
    const skipped = queue.forceSkipActive();
    if (skipped) sendLog('⏭️ Active task force-skipped by user');
    return skipped;
  });

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

  registerFileHandlers();
  registerTelegramHandlers(ctx);
  registerLocaleHandlers(ctx);
  registerSettingsHandlers(ctx);
  registerFlowHandlers(ctx);
  registerAccountHandlers();
  registerEmailHandlers();
}
