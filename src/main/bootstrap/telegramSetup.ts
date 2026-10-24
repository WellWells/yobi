import { IPC, isSocketBotPlatform } from '../../shared/types';
import type { FlowExecutionResult } from '../../shared/types';
import { BOT_MODEL_VARIABLE, TRIGGER_IS_INPUT_VARIABLE } from '../../shared/builtinFlows';
import {
  botAccessDeniedText,
  botBuiltinAllowed,
  botChatAllowed,
  botDownloadAllowed,
  botFlowAdminAllowed,
  botFlowAllowed,
  grantPairingDefaults,
  isBotGroupPending,
  isBotUserBlocked,
  notifyBotGroupJoined,
  pairedMenuAccess,
  setBotGroupPermissions,
} from '../botPermissions';
import { getBotAudience } from '../botPermissions/audience';
import { currentLinkSiteFilter } from '../linkRecognition';
import { registerTelegramPairer, telegramAccountAdmin, telegramInvites } from './telegramAccountAdmin';
import { isBuiltinConnectorOn } from '../botPermissions/managedAccounts';
import { config, getHiddenSources, saveConfig } from '../config';
import { resolveLlmDirectTarget } from '../providerCommands';
import { relaunchApp, sendLog, sendToRenderer, createTaskId } from '../helpers';
import { getLangCache, t } from '../i18n';
import { isFlowAdminOnly } from '../../shared/botCommandAccess';
import { resolveUrlPrompt } from '../urlParser';
import { withPublicWebOnly } from '../net/publicWebScope';
import { TelegramRuntime, normalizePairingState, parseRecipientIds } from '../telegram';
import { sweepOrphanTempAttachments } from '../telegram/fileDownload';
import { uploadFallbackUrl } from '../telegram/attachmentPlan';
import { registerTelegramLargeUploader } from '../telegram/mtproto';
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
  markAgentAskShown,
  newConversationLabel,
  pendingAgentAskRunId,
  resumeBotAgentAsk,
  runBotBuiltinCommand,
  takePendingAgentAnswer,
} from '../botBuiltinCommands';
import {
  isTelegramAdminUser,
  buildTelegramStatusText,
  getTelegramRuntimeSnapshot,
  setTelegramRuntimeSnapshot,
  exportTelegramResultDocument,
} from '../telegramBridge';
import { listBotContacts, listBotPairedContacts, recordBotUse } from '../botDirectory';
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

  // Files over the Bot API's 50 MB go up over MTProto as the same bot (Settings › Telegram).
  registerTelegramLargeUploader({
    getCredentials: () => ({
      apiId: config.telegram.apiId,
      apiHash: config.telegram.apiHash,
      botToken: config.telegram.botToken,
    }),
    log: sendLog,
  });

  // The private chats a group's or a pairing request's card goes to: the owner and admin-grant holders, paired.
  const getManagerIds = async (): Promise<number[]> => (await pairedMenuAccess('telegram'))
    .filter((entry) => entry.flowAdmin)
    .map((entry) => Number(entry.userId))
    .filter((id) => Number.isSafeInteger(id) && id > 0);

  const runtime: TelegramRuntime = new TelegramRuntime({
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
    grantPairingDefaults: (userId) => grantPairingDefaults('telegram', String(userId)),
    getChannels: () => config.telegram.channels,
    saveChannels: (next) => {
      config.telegram.channels = next;
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
    canUseDownloader: (userId, chatId) => botDownloadAllowed('telegram', String(userId), String(chatId)),
    linkSites: currentLinkSiteFilter,
    canChat: (userId, chatId) => botChatAllowed('telegram', String(userId), String(chatId)),
    isFlowAdmin: (userId, chatId) => botFlowAdminAllowed('telegram', String(userId), String(chatId)),
    isBlocked: (userId) => isBotUserBlocked('telegram', String(userId)),
    isGroupPending: (chatId) => isBotGroupPending('telegram', String(chatId)),
    onGroupJoined: (group) => {
      if (notifyBotGroupJoined('telegram', group)) sendLog(`[telegram] added to group ${group.id} — waiting for approval in settings`);
    },
    groupAdmin: {
      listGroups: async () => (await getBotAudience('telegram')).groups.map(({ id, title, pending, grants }) => ({
        id,
        ...(title ? { title } : {}),
        pending,
        grants,
      })),
      // The same write as the settings page; the page refetches on the runtime broadcast.
      setGrants: (chatId, grants) => {
        const result = setBotGroupPermissions({ platform: 'telegram', chatId, grants });
        if (!result.ok) {
          sendLog(`[bot] group permissions change from Telegram refused: ${result.reason}`);
          return false;
        }
        sendToRenderer(IPC.TELEGRAM_RUNTIME, getTelegramRuntimeSnapshot());
        return true;
      },
      isConnectorOn: isBuiltinConnectorOn,
      getManagerIds,
    },
    accountAdmin: telegramAccountAdmin(() => runtime, getManagerIds),
    invites: telegramInvites(),
    onUse: (user, chatId) => {
      void recordBotUse({
        platform: 'telegram',
        id: String(user.userId),
        ...(user.username ? { username: user.username } : {}),
        ...(user.firstName ? { firstName: user.firstName } : {}),
        ...(user.lastName ? { lastName: user.lastName } : {}),
      }, String(chatId)).catch(() => undefined);
    },
    getMenuAccess: async () => (await pairedMenuAccess('telegram')).map((entry) => ({ ...entry, userId: Number(entry.userId) })),
    getEffectiveTargetUrl: () => resolveLlmDirectTarget(
      config.telegram.llmDirect,
      getHiddenSources(),
    ).targetUrl || config.targetUrl,
    getUploadFallbackUrl: () => uploadFallbackUrl(getHiddenSources()),
    getByokContextBudgetChars: () => config.byokContextBudgetChars,
    onTaskRequest: async (request) => {
      const requestTarget = request.targetUrl || config.targetUrl;
      // A link sent with a photo or file is read for the chat: the public web only.
      const resolved = await withPublicWebOnly(() => resolveUrlPrompt(request.prompt, {
        langData: getLangCache(),
        youtubePrompt: config.youtubePrompt,
        targetUrl: requestTarget,
        onLog: sendLog,
      }));
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
        ...(request.uploadFallback ? { uploadFallback: true } : {}),
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
    onBuiltinCommand: (key, input, targetUrl, chatId, userId, onProgressText, chat) => runBotBuiltinCommand(
      { getFlowManager, getStrings: getLangCache },
      {
        key,
        input,
        targetUrl,
        chatKey: botChatKey('telegram', String(chatId), String(userId)),
        onProgressText,
        ...chat,
      },
    ),
    onAgentAnswer: async (answer, chatId, userId, onProgressText) => {
      const chatKey = botChatKey('telegram', String(chatId), String(userId));
      const pending = takePendingAgentAnswer(chatKey);
      if (!pending) return null;
      return resumeBotAgentAsk(
        { getFlowManager, getStrings: getLangCache },
        { runId: pending.runId, answer, chatKey, numbered: pending.numbered, onProgressText },
      );
    },
    hasPendingAgentAsk: (chatId, userId, sent) => hasPendingAgentAsk(
      botChatKey('telegram', String(chatId), String(userId)),
      sent,
    ),
    markAgentAskShown: (chatId, userId, shown) => markAgentAskShown(
      botChatKey('telegram', String(chatId), String(userId)),
      shown,
    ),
    pendingAgentAskRunId: (chatId, userId) => pendingAgentAskRunId(
      botChatKey('telegram', String(chatId), String(userId)),
    ),
    onDropAgentAsk: (chatId, userId) => clearPendingAgentAsk(
      botChatKey('telegram', String(chatId), String(userId)),
    ),
    onNewConversation: (chatId, userId) => clearBotConversation(
      botChatKey('telegram', String(chatId), String(userId)),
    ),
    getFlowCommands: () => getFlowManager()?.getBotCommands() ?? [],
    onFlowCommand: async (flowId, inputVariable, input, userId, chatId, onProgress, messageId, messageIsInput) => {
      const extraContext: Record<string, string> = {
        [inputVariable]: input,
        'bot.triggerChatId': String(chatId),
        ...(messageId ? { 'bot.triggerMessageId': String(messageId) } : {}),
        ...(messageId && messageIsInput ? { [TRIGGER_IS_INPUT_VARIABLE]: '1' } : {}),
        'bot.triggerUserId': String(userId),
        'bot.triggerPlatform': 'telegram',
        [BOT_MODEL_VARIABLE]: resolveLlmDirectTarget(config.telegram.llmDirect, getHiddenSources()).targetUrl,
      };
      const flowManager = getFlowManager();
      if (!flowManager) return notRun(flowId, 'FlowManager not available');
      if (isFlowAdminOnly(flowManager.getBotCommands(), flowId)
        && !(await botFlowAdminAllowed('telegram', String(userId), String(chatId)))) {
        sendLog(`[Flow] Bot flow ${flowId} refused for user ${userId} in chat ${chatId} — limited to admins in a private chat`);
        return notRun(flowId, 'Flow command limited to admins', t(getLangCache(), 'bot.chat.flowNotAllowed'));
      }
      if (!(await botFlowAllowed('telegram', flowId, String(userId), String(chatId)))) {
        sendLog(`[Flow] Bot flow ${flowId} refused for user ${userId} — no download grant`);
        return notRun(flowId, 'Downloader not granted', botAccessDeniedText(getLangCache(), 'download'));
      }
      const execution = flowManager.queueExecutionWithId(flowId, extraContext, 'bot', onProgress);
      sendLog(`[Flow] Bot command triggered flow ${flowId} for user ${userId} with input: ${input}`);
      return execution;
    },
  });
  // The settings page's "Allow" on a pairing request pairs through this runtime.
  registerTelegramPairer(runtime);
  return runtime;
}

/** A flow command that was never queued, reported the way a failed run is. */
function notRun(flowId: string, error: string, displayError?: string): { taskId: string; result: Promise<FlowExecutionResult> } {
  return {
    taskId: createTaskId(),
    result: Promise.resolve({
      flowId,
      success: false,
      outputs: {},
      error,
      ...(displayError ? { displayError } : {}),
      completedSteps: 0,
      totalSteps: 0,
      completedAt: new Date().toISOString(),
    }),
  };
}

function collectFlowRecipientIds(flowManager: FlowManager | null): number[] {
  if (!flowManager) return [];
  const raw: string[] = [];
  for (const flow of flowManager.getAll()) {
    for (const step of flow.steps) {
      if (step.type !== 'bot') continue;
      // Another bot's ids are not Telegram chats (a flow variable or `auto` may still mean Telegram).
      const platform = (step.config.platform ?? '').trim().toLowerCase();
      if (platform === 'line' || isSocketBotPlatform(platform)) continue;
      raw.push(String(step.config.chatIds ?? ''), String(step.config.chatId ?? ''));
    }
  }
  return parseRecipientIds(raw);
}
