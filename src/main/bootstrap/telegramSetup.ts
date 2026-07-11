import { IPC } from '../../shared/types';
import { config, saveConfig } from '../config';
import { relaunchApp, sendLog, sendToRenderer, sendWebNotification, createTaskId } from '../helpers';
import { getLangCache } from '../i18n';
import { resolveUrlPrompt } from '../urlParser';
import { TelegramRuntime, normalizePairingState } from '../telegram';
import { resolveBotCommands } from './botCommands';
import {
  isTelegramAdminUser,
  buildTelegramStatusText,
  getTelegramRuntimeSnapshot,
  setTelegramRuntimeSnapshot,
  exportTelegramResultDocument,
} from '../telegramBridge';
import type { QueueManager } from '../queueManager';
import type { FlowManager } from '../flow';

export function createTelegramRuntime(deps: {
  queue: QueueManager;
  getFlowManager: () => FlowManager | null;
}): TelegramRuntime {
  const { queue, getFlowManager } = deps;

  return new TelegramRuntime({
    getEnabled: () => config.telegram.enabled,
    getToken: () => config.telegram.botToken,
    getAllowGroupCommands: () => config.telegram.allowGroupCommands,
    getLlmDirect: () => config.telegram.llmDirect,
    getDefaultReplyMode: () => config.telegram.defaultReplyMode,
    getCompactReply: () => config.telegram.compactReply,
    getPairing: () => config.telegram.pairing,
    savePairing: (next) => {
      config.telegram.pairing = normalizePairingState(next);
      saveConfig({ telegram: config.telegram });
      sendToRenderer(IPC.TELEGRAM_RUNTIME, getTelegramRuntimeSnapshot());
    },
    isAdminUser: (userId) => isTelegramAdminUser(userId),
    onTaskRequest: async (request) => {
      const resolved = await resolveUrlPrompt(request.prompt, {
        langData: getLangCache(),
        youtubePrompt: config.youtubePrompt,
        onLog: sendLog,
        onNotify: (title, body) => sendWebNotification(title, body, 'info'),
      });
      const id = createTaskId();
      queue.enqueue({
        id,
        prompt: resolved.prompt,
        // Command-free chat sends '' when set to follow the app default.
        targetUrl: resolved.forceProviderUrl ?? (request.targetUrl || config.targetUrl),
        title: resolved.title,
        source: 'telegram',
        replyTarget: request.replyTarget,
        requesterName: request.requesterName,
      });
      sendLog(`[${id}] Telegram /${request.command} queued`);
      return { taskId: id };
    },
    onStatusRequest: () => buildTelegramStatusText(queue),
    onRestartApp: () => relaunchApp('Telegram /restart'),
    // '/output compact' flips the switch; naming any real format turns it off —
    // asking for a PDF and getting plain text would be the command lying.
    onUpdateOutputChoice: (choice) => {
      if (choice === 'compact') {
        config.telegram.compactReply = true;
      } else if (choice === 'markdown' || choice === 'png' || choice === 'webp' || choice === 'pdf') {
        config.telegram.compactReply = false;
        config.telegram.defaultReplyMode = choice;
      } else {
        return false;
      }
      saveConfig({ telegram: config.telegram });
      return true;
    },
    onExportRequest: (request) => exportTelegramResultDocument(request),
    onLog: (message) => sendLog(message),
    onRuntime: (snapshot) => {
      setTelegramRuntimeSnapshot(snapshot);
      sendToRenderer(IPC.TELEGRAM_RUNTIME, snapshot);
    },
    getStrings: () => getLangCache(),
    // Providers first, then BYOK keys/groups; BYOK yields on any name collision.
    getProviderCommands: () => {
      const { providers, byok } = resolveBotCommands(getFlowManager);
      return [
        ...providers,
        ...byok.map((bc) => ({
          provider: 'byok' as const,
          command: bc.command,
          targetUrl: bc.targetUrl,
          description: bc.label,
        })),
      ];
    },
    getFlowCommands: () => getFlowManager()?.getBotCommands() ?? [],
    onFlowCommand: async (flowId, inputVariable, input, userId, chatId) => {
      const extraContext: Record<string, string> = {
        [inputVariable]: input,
        'bot.triggerChatId': String(chatId),
        'bot.triggerUserId': String(userId),
        'bot.triggerPlatform': 'telegram',
      };
      const flowManager = getFlowManager();
      if (!flowManager) {
        return {
          taskId: createTaskId(),
          result: Promise.resolve({
            flowId,
            success: false,
            outputs: {},
            error: 'FlowManager not available',
            completedSteps: 0,
            totalSteps: 0,
            completedAt: new Date().toISOString(),
          }),
        };
      }
      const execution = flowManager.queueExecutionWithId(flowId, extraContext, 'bot');
      sendLog(`[AgentFlow] Bot command triggered flow ${flowId} for user ${userId} with input: ${input}`);
      return execution;
    },
  });
}
