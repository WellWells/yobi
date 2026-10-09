import { IPC } from '../../shared/types';
import { botBuiltinAllowed, pairedMenuAccess } from '../botPermissions';
import { config, getHiddenSources, saveConfig } from '../config';
import { resolveLlmDirectTarget } from '../providerCommands';
import { relaunchApp, sendLog, sendToRenderer, createTaskId } from '../helpers';
import { getLangCache } from '../i18n';
import { resolveUrlPrompt } from '../urlParser';
import { TelegramRuntime, normalizePairingState, parseRecipientIds } from '../telegram';
import { sweepOrphanTempAttachments } from '../telegram/fileDownload';
import {
  clearBotConversation,
  collectPairedUserIdsFromKeys,
  getBotConversation,
  listBotConversationKeys,
} from '../botConversations';
import { resolveBotCommands } from './botCommands';
import {
  botChatKey,
  clearPendingAgentAsk,
  hasPendingAgentAsk,
  newConversationLabel,
  resumeBotAgentAsk,
  runBotBuiltinCommand,
  takePendingAgentAsk,
} from '../botBuiltinCommands';
import {
  isTelegramAdminUser,
  buildTelegramStatusText,
  getTelegramRuntimeSnapshot,
  setTelegramRuntimeSnapshot,
  exportTelegramResultDocument,
} from '../telegramBridge';
import { listBotContacts, listBotPairedContacts } from '../botDirectory';
import { appQueueState, type QueueManager } from '../queueManager';
import type { FlowManager } from '../flow';

export function createTelegramRuntime(deps: {
  queue: QueueManager;
  getFlowManager: () => FlowManager | null;
}): TelegramRuntime {
  const { queue, getFlowManager } = deps;

  void sweepOrphanTempAttachments().then((removed) => {
    if (removed > 0) sendLog(`[telegram] swept ${removed} orphaned media temp file(s)`);
  });

  return new TelegramRuntime({
    getEnabled: () => config.telegram.enabled,
    getToken: () => config.telegram.botToken,
    getAllowGroupCommands: () => config.telegram.allowGroupCommands,
    getLlmDirect: () => resolveLlmDirectTarget(config.telegram.llmDirect, getHiddenSources()),
    getDefaultReplyMode: () => config.telegram.defaultReplyMode,
    getCompactReply: () => config.telegram.compactReply,
    getPairing: () => config.telegram.pairing,
    savePairing: (next) => {
      config.telegram.pairing = normalizePairingState(next);
      saveConfig({ telegram: config.telegram });
      sendToRenderer(IPC.TELEGRAM_RUNTIME, getTelegramRuntimeSnapshot());
    },
    getChannels: () => config.telegram.channels,
    saveChannels: (next) => {
      config.telegram.channels = next;
      saveConfig({ telegram: config.telegram });
      sendToRenderer(IPC.TELEGRAM_RUNTIME, getTelegramRuntimeSnapshot());
    },
    getKnownUsers: () => config.telegram.knownUsers,
    saveKnownUsers: (next) => {
      config.telegram.knownUsers = next;
      saveConfig({ telegram: config.telegram });
      sendToRenderer(IPC.TELEGRAM_RUNTIME, getTelegramRuntimeSnapshot());
    },
    getDirectorySources: async () => {
      const contacts = await listBotContacts({ platform: 'telegram', kind: 'chat' });
      const paired = await listBotPairedContacts('telegram');
      return {
        adminUserIds: config.telegram.adminUserIds,
        flowRecipientIds: collectFlowRecipientIds(getFlowManager()),
        conversationUserIds: collectPairedUserIdsFromKeys(await listBotConversationKeys(), 'telegram'),
        ledgerChatIds: contacts.map((entry) => Number(entry.id)).filter((id) => Number.isFinite(id)),
        ledgerPairedUserIds: paired.map((entry) => Number(entry.id)).filter((id) => Number.isFinite(id)),
      };
    },
    isAdminUser: (userId) => isTelegramAdminUser(userId),
    canUseBuiltin: (key, userId, chatId) => botBuiltinAllowed('telegram', key, String(userId), String(chatId)),
    getMenuAccess: async () => (await pairedMenuAccess('telegram')).map((entry) => ({ ...entry, userId: Number(entry.userId) })),
    getEffectiveTargetUrl: () => resolveLlmDirectTarget(
      config.telegram.llmDirect,
      getHiddenSources(),
    ).targetUrl || config.targetUrl,
    getByokContextBudgetChars: () => config.byokContextBudgetChars,
    onTaskRequest: async (request) => {
      const requestTarget = request.targetUrl || config.targetUrl;
      const resolved = await resolveUrlPrompt(request.prompt, {
        langData: getLangCache(),
        youtubePrompt: config.youtubePrompt,
        targetUrl: requestTarget,
        onLog: sendLog,
      });
      const id = createTaskId();
      const sessionKey = botChatKey(
        'telegram',
        String(request.replyTarget.chatId),
        String(request.replyTarget.userId),
      );
      const conversationPath = await getBotConversation(sessionKey);
      const fileLabel = conversationPath ? '' : await newConversationLabel(sessionKey);
      queue.enqueue({
        id,
        prompt: resolved.prompt,
        displayPrompt: resolved.displayPrompt,
        targetUrl: resolved.forceProviderUrl ?? requestTarget,
        title: resolved.title,
        source: 'telegram',
        replyTarget: request.replyTarget,
        requesterName: request.requesterName,
        sessionKey,
        ...(resolved.prompt !== request.prompt ? { external: true } : {}),
        ...(resolved.map ? { mapPlace: resolved.map } : {}),
        ...(request.attachments?.length
          ? { attachments: request.attachments, ephemeralAttachments: true }
          : {}),
        ...(conversationPath ? { conversationPath } : {}),
        ...(fileLabel ? { fileLabel } : {}),
      });
      sendLog(`[${id}] Telegram /${request.command} queued`);
      return { taskId: id };
    },
    onStatusRequest: () => buildTelegramStatusText(appQueueState(queue, getFlowManager())),
    onRestartApp: () => relaunchApp('Telegram /restart'),
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
    getBuiltinCommands: () => resolveBotCommands(getFlowManager).builtins,
    onBuiltinCommand: (key, input, targetUrl, chatId, userId, onProgressText) => runBotBuiltinCommand(
      { getFlowManager, getStrings: getLangCache },
      {
        key,
        input,
        targetUrl,
        chatKey: botChatKey('telegram', String(chatId), String(userId)),
        onProgressText,
      },
    ),
    onAgentAnswer: async (answer, chatId, userId, onProgressText) => {
      const chatKey = botChatKey('telegram', String(chatId), String(userId));
      const runId = takePendingAgentAsk(chatKey);
      if (!runId) return null;
      return resumeBotAgentAsk(
        { getFlowManager, getStrings: getLangCache },
        { runId, answer, chatKey, onProgressText },
      );
    },
    hasPendingAgentAsk: (chatId, userId) => hasPendingAgentAsk(
      botChatKey('telegram', String(chatId), String(userId)),
    ),
    onDropAgentAsk: (chatId, userId) => clearPendingAgentAsk(
      botChatKey('telegram', String(chatId), String(userId)),
    ),
    onNewConversation: (chatId, userId) => clearBotConversation(
      botChatKey('telegram', String(chatId), String(userId)),
    ),
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
      sendLog(`[Flow] Bot command triggered flow ${flowId} for user ${userId} with input: ${input}`);
      return execution;
    },
  });
}

function collectFlowRecipientIds(flowManager: FlowManager | null): number[] {
  if (!flowManager) return [];
  const raw: string[] = [];
  for (const flow of flowManager.getAll()) {
    for (const step of flow.steps) {
      if (step.type !== 'bot') continue;
      const platform = step.config.platform;
      if (platform === 'line') continue;
      raw.push(String(step.config.chatIds ?? ''), String(step.config.chatId ?? ''));
    }
  }
  return parseRecipientIds(raw);
}
