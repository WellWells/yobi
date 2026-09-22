import { ipcMain, nativeImage, shell } from 'electron';
import * as fs from 'node:fs/promises';
import { IPC } from '../../shared/types';
import type { AgentConfirmChoice, PromptTriggerOptions, SelectPathRequest, SelectPathResult } from '../../shared/types';
import { resolveAgentConfirm } from '../chat/agentConfirmBridge';
import { config, saveConfig } from '../config';
import { getProviderLabel } from '../providers';
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
import { titleFromPrompt } from '../output';
import { resolveUrlPrompt } from '../urlParser';
import {
  revealWorkerWindow,
  ensureWorkerWindow,
} from '../windows';
import type { IpcContext } from './context';
import { showOpenDialogForWin } from './context';
import { registerFileHandlers } from './files';
import { registerTelegramHandlers } from './telegram';
import { registerLineHandlers } from './line';
import { registerBotHandlers } from './bot';
import { registerLocaleHandlers } from './locale';
import { registerSettingsHandlers } from './settings';
import { registerBackupHandlers } from './backup';
import { registerFlowHandlers } from './flow';
import { registerAgentHandlers } from './agent';
import { registerAccountHandlers } from './account';
import { registerEmailHandlers } from './email';
import { registerDataKeyHandlers } from './dataKeys';
import { registerByokHandlers } from './byok';
import { registerMcpHandlers } from './mcp';
import { registerShareHandlers } from './share';
import { registerGeminiModelHandlers } from './geminiModel';
import { registerClaudeModelHandlers } from './claudeModel';
import { registerChatgptModelHandlers } from './chatgptModel';
import { registerMemoryHandlers } from './memory';
import { registerMemoryCurateHandlers } from './memoryCurate';

let _ipcInitialized = false;

export function setupIpcHandlers(deps: IpcContext): void {
  if (_ipcInitialized) {
    console.warn('[ipcHandlers] setupIpcHandlers called multiple times — skipping duplicate registration');
    return;
  }
  _ipcInitialized = true;

  const { queue, getMainWin, checkForUpdates } = deps;
  const ctx = deps;

  async function enqueuePromptFromUi(
    rawPrompt: string,
    targetUrl?: string,
    attachments?: string[],
    conversation?: { conversationPath?: string; sendId?: string },
  ): Promise<string | null> {
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
      displayPrompt: resolved.displayPrompt,
      targetUrl: finalTargetUrl,
      title: resolved.title,
      source: 'ui',
      attachments,
      conversationPath: conversation?.conversationPath,
      placeholderTitle: titleFromPrompt(text),
      sendId: conversation?.sendId,
      ...(resolved.prompt !== text ? { external: true } : {}),
    });
    sendLog(`[${id}] 🎯 UI prompt queued for ${getProviderLabel(finalTargetUrl)}`);
    return id;
  }

  ipcMain.on(IPC.SHOW_WORKER, async () => {
    await ensureWorkerWindow(config.targetUrl);
    revealWorkerWindow();
  });
  ipcMain.handle(IPC.UPDATE_CHECK, () => checkForUpdates());

  ipcMain.on(IPC.WINDOW_MINIMIZE, () => getMainWin()?.minimize());
  ipcMain.on(IPC.WINDOW_MAXIMIZE, () => {
    const win = getMainWin();
    if (win?.isMaximized()) win.unmaximize();
    else win?.maximize();
  });
  ipcMain.on(IPC.WINDOW_CLOSE, () => getMainWin()?.close());
  ipcMain.handle(IPC.WINDOW_IS_MAXIMIZED, () => getMainWin()?.isMaximized() === true);

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
    enqueuePromptFromUi(options?.prompt ?? '', options?.targetUrl, options?.attachments, {
      conversationPath: options?.conversationPath,
      sendId: options?.sendId,
    }),
  );

  ipcMain.handle(IPC.CANCEL_QUEUE_TASK, (_event, taskId: string) => {
    const normalizedTaskId = (taskId ?? '').trim();
    if (!normalizedTaskId) return false;
    const cancelled = queue.cancel(normalizedTaskId)
      || (deps.flowManager?.cancelQueuedTask(normalizedTaskId) ?? false);
    if (cancelled) sendLog(`[${normalizedTaskId}] 🛑 Queue item cancelled`);
    return cancelled;
  });

  ipcMain.handle(IPC.FORCE_SKIP_ACTIVE_TASK, () => {
    const skipped = queue.forceSkipActive();
    // Honest wording: nothing here can abort provider automation, so the task is only
    // released from the queue — it may still finish and save its answer.
    if (skipped) sendLog('⏭️ Stopped waiting for the active task — it may still finish');
    return skipped;
  });

  ipcMain.on(IPC.AGENT_CONFIRM_RESPOND, (_event, id: string, choice: AgentConfirmChoice) => {
    resolveAgentConfirm(id, choice);
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

  registerFileHandlers();
  registerTelegramHandlers(ctx);
  registerLineHandlers(ctx);
  registerBotHandlers(ctx);
  registerLocaleHandlers(ctx);
  registerSettingsHandlers(ctx);
  registerBackupHandlers(ctx);
  registerFlowHandlers(ctx);
  registerAgentHandlers(ctx);
  registerAccountHandlers();
  registerEmailHandlers();
  registerDataKeyHandlers();
  registerByokHandlers(ctx);
  registerMcpHandlers();
  registerShareHandlers();
  registerGeminiModelHandlers();
  registerClaudeModelHandlers();
  registerChatgptModelHandlers();
  registerMemoryHandlers();
  registerMemoryCurateHandlers();
}
