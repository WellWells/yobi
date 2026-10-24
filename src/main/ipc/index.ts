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
  isHttpUrl,
  normalizeAiUrl,
  createTaskId,
  getAssetPath,
} from '../helpers';
import { loadLanguageData } from '../i18n';
import { titleFromPrompt } from '../output';
import { whileConversationBusy } from '../conversationBusy';
import { resolveUrlPrompt } from '../urlParser';
import { showWorkerWindow } from '../windows';
import { openOfferedSiteVerification } from '../siteVerification';
import type { IpcContext } from './context';
import { showOpenDialogForWin } from './context';
import { registerFileHandlers } from './files';
import { registerConversationMoveHandlers } from './conversationMove';
import { registerConversationTrashHandlers } from './conversationTrash';
import { registerConversationFolderHandlers } from './conversationFolders';
import { registerConversationHistoryHandlers } from './conversationHistory';
import { registerNotionHandlers } from './notion';
import { registerYtdlHandlers } from './ytdl';
import { registerBatchExportHandlers } from './batchExport';
import { registerComposerEditorHandlers } from './composerEditor';
import { registerTelegramHandlers } from './telegram';
import { registerLineHandlers } from './line';
import { registerSocketBotHandlers } from './socketBots';
import { announceBotPermissionsChanged, registerBotPermissionsHandlers } from './botPermissions';
import { registerBotHandlers } from './bot';
import { registerLocaleHandlers } from './locale';
import { registerSettingsHandlers } from './settings';
import { registerBackupHandlers } from './backup';
import { registerFlowHandlers } from './flow';
import { registerFeedPreviewHandlers } from './feedPreview';
import { registerPttBoardHandlers } from './pttBoard';
import { registerAgentHandlers } from './agent';
import { registerAccountHandlers } from './account';
import { registerEmailHandlers } from './email';
import { registerDataKeyHandlers } from './dataKeys';
import { registerCalendarHandlers } from './calendars';
import { registerByokHandlers } from './byok';
import { registerMcpHandlers } from './mcp';
import { registerShareHandlers } from './share';
import { registerGeminiModelHandlers } from './geminiModel';
import { registerClaudeModelHandlers } from './claudeModel';
import { registerChatgptModelHandlers } from './chatgptModel';
import { registerMemoryHandlers } from './memory';
import { registerMemoryCurateHandlers } from './memoryCurate';
import { registerWritingToolsHandlers } from './writingTools';
import { registerDocAssistantHandlers } from './docAssistant';
import { registerTranslateHandlers } from './translate';
import { registerMarkdownExportHandlers } from './markdownExport';
import { registerConversationPinHandlers } from './conversationPin';
import { registerConversationMenuHandlers } from './conversationMenu';
import { registerRegionCaptureHandlers } from '../regionCapture';

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
    // Busy from the moment the send arrives: reading a pasted link can take seconds before the
    // task is queued, and the queue holds the mark from then on.
    return whileConversationBusy(conversation?.conversationPath, 'sending', () => queuePromptFromUi(text, targetUrl, attachments, conversation));
  }

  async function queuePromptFromUi(
    text: string,
    targetUrl?: string,
    attachments?: string[],
    conversation?: { conversationPath?: string; sendId?: string },
  ): Promise<string | null> {
    const resolvedTargetUrl = targetUrl?.trim()
      ? normalizeAiUrl(targetUrl)
      : config.targetUrl;

    const langData = await loadLanguageData(config.locale) ?? {};
    const resolved = await resolveUrlPrompt(text, {
      langData: langData as Record<string, string>,
      youtubePrompt: config.youtubePrompt,
      targetUrl: resolvedTargetUrl,
      onLog: sendLog,
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
      ...(resolved.map ? { mapPlace: resolved.map } : {}),
      ...(resolved.forceProviderUrl ? { providerPinned: true as const } : {}),
    });
    sendLog(`[${id}] 🎯 UI prompt queued for ${getProviderLabel(finalTargetUrl)}`);
    return id;
  }

  ipcMain.on(IPC.SHOW_WORKER, () => {
    void showWorkerWindow(config.targetUrl);
  });
  // The in-app toast's button, when the OS could not show the notification that offers it.
  ipcMain.on(IPC.SITE_VERIFICATION_OPEN, (_event, site: unknown) => {
    if (typeof site === 'string') openOfferedSiteVerification(site);
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
    // Nothing here can abort provider automation: the task only leaves the queue and may still
    // save its answer.
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
  registerConversationMoveHandlers();
  registerConversationTrashHandlers();
  registerConversationFolderHandlers();
  registerConversationHistoryHandlers();
  registerNotionHandlers();
  registerYtdlHandlers();
  registerBatchExportHandlers();
  registerComposerEditorHandlers();
  registerTelegramHandlers(ctx);
  registerLineHandlers(ctx);
  registerSocketBotHandlers(ctx);
  registerBotPermissionsHandlers(ctx);
  registerBotHandlers(ctx);
  registerLocaleHandlers(ctx);
  registerSettingsHandlers(ctx);
  registerBackupHandlers(ctx);
  registerFlowHandlers(ctx);
  registerFeedPreviewHandlers();
  registerPttBoardHandlers();
  registerAgentHandlers(ctx);
  registerAccountHandlers();
  registerEmailHandlers();
  registerDataKeyHandlers();
  registerCalendarHandlers();
  registerByokHandlers(ctx);
  registerMcpHandlers();
  registerShareHandlers();
  registerGeminiModelHandlers();
  registerClaudeModelHandlers();
  registerChatgptModelHandlers();
  registerMemoryHandlers(() => announceBotPermissionsChanged(ctx, 'telegram'));
  registerMemoryCurateHandlers();
  registerWritingToolsHandlers();
  registerDocAssistantHandlers();
  registerTranslateHandlers();
  registerMarkdownExportHandlers();
  registerConversationPinHandlers();
  registerConversationMenuHandlers();
  registerRegionCaptureHandlers();
}
