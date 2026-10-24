/**
 * The router's wiring every platform with string ids shares (LINE, Discord, Slack): grants, the
 * contact directory, the agent's questions, conversations and flow commands, all keyed by the
 * platform. A platform's setup adds only what is its own (pairing, owner cards, its runtime).
 */
import { BOT_MODEL_VARIABLE } from '../../shared/builtinFlows';
import { BOT_PLATFORM_NAMES } from '../../shared/types';
import type { BotPlatform } from '../../shared/types';
import { isFlowAdminOnly } from '../../shared/botCommandAccess';
import {
  botAccessDeniedText,
  botBuiltinAllowed,
  botChatAllowed,
  botDownloadAllowed,
  botFlowAdminAllowed,
  botFlowAllowed,
  isBotGroupPending,
  isBotUserBlocked,
} from '../botPermissions';
import { currentLinkSiteFilter } from '../linkRecognition';
import { markBotReachable, markBotUnreachable, recordBotContact, recordBotUse } from '../botDirectory';
import { config, getHiddenSources } from '../config';
import { resolveLlmDirectTarget } from '../providerCommands';
import { createTaskId, sendLog } from '../helpers';
import { getLangCache, t } from '../i18n';
import { clearBotConversation } from '../botConversations';
import { resolveBotCommands } from './botCommands';
import {
  botChatKey,
  clearPendingAgentAsk,
  hasPendingAgentAsk,
  resumeBotAgentAsk,
  runBotBuiltinCommand,
  takePendingAgentAnswer,
} from '../botBuiltinCommands';
import type { BotChatEvent, BotChatRouterDeps } from '../botChat/types';
import type { FlowManager } from '../flow';

type PlatformOwned = 'platform' | 'output' | 'pace' | 'ownerCommands' | 'isPairedUser' | 'consumePairingCode'
  | 'onPairingRequest' | 'onCodePaired' | 'onGroupJoined';

export type SharedBotChatDeps<E extends BotChatEvent> = Omit<BotChatRouterDeps<E>, PlatformOwned>;

export function botChatDeps<E extends BotChatEvent>(
  platform: BotPlatform,
  getFlowManager: () => FlowManager | null,
): SharedBotChatDeps<E> {
  const name = BOT_PLATFORM_NAMES[platform];
  const builtinDeps = { getFlowManager, getStrings: getLangCache };
  return {
    onLog: (message) => sendLog(message),
    getStrings: () => getLangCache(),
    getLlmDirect: () => resolveLlmDirectTarget(config[platform].llmDirect, getHiddenSources()),
    getProviderCommands: () => resolveBotCommands(getFlowManager).providers,
    getByokCommands: () => resolveBotCommands(getFlowManager).byok,
    getBuiltinCommands: () => resolveBotCommands(getFlowManager).builtins,
    onBuiltinCommand: (key, input, targetUrl, chatId, userId) => runBotBuiltinCommand(
      builtinDeps,
      { key, input, targetUrl, chatKey: botChatKey(platform, chatId, userId) },
    ),
    canUseBuiltin: (key, chatId, userId) => botBuiltinAllowed(platform, key, userId, chatId),
    canUseDownloader: (chatId, userId) => botDownloadAllowed(platform, userId, chatId),
    linkSites: currentLinkSiteFilter,
    canChat: (chatId, userId) => botChatAllowed(platform, userId, chatId),
    isFlowAdmin: (chatId, userId) => botFlowAdminAllowed(platform, userId, chatId),
    isBlocked: (userId) => isBotUserBlocked(platform, userId),
    isGroupPending: (chatId) => isBotGroupPending(platform, chatId),
    onUse: (user, chatId) => {
      void recordBotUse({ platform, id: user.userId, ...(user.displayName ? { firstName: user.displayName } : {}) }, chatId)
        .catch(() => undefined);
    },
    onGroupSeen: (group) => {
      void recordBotContact({ platform, kind: 'chat', id: group.chatId, ...(group.title ? { title: group.title } : {}) })
        .then(() => markBotReachable(platform, 'chat', group.chatId))
        .catch(() => undefined);
    },
    onGroupLeft: (chatId) => {
      void markBotUnreachable(platform, 'chat', chatId, 'removed').catch(() => undefined);
    },
    onAgentAnswer: async (answer, chatId, userId) => {
      const chatKey = botChatKey(platform, chatId, userId);
      const pending = takePendingAgentAnswer(chatKey);
      if (!pending) return null;
      // A typed "2" is the second choice only where the choices were shown numbered.
      return resumeBotAgentAsk(builtinDeps, { runId: pending.runId, answer, chatKey, numbered: pending.numbered });
    },
    hasPendingAgentAsk: (chatId, userId, sent) => hasPendingAgentAsk(botChatKey(platform, chatId, userId), sent),
    onDropAgentAsk: (chatId, userId) => clearPendingAgentAsk(botChatKey(platform, chatId, userId)),
    onNewConversation: (chatId, userId) => clearBotConversation(botChatKey(platform, chatId, userId)),
    getFlowCommands: () => getFlowManager()?.getBotCommands() ?? [],
    onFlowCommand: async (flowId, inputVariable, input, userId, chatId, messageId) => {
      const flowManager = getFlowManager();
      if (!flowManager) {
        return { taskId: createTaskId(), result: Promise.resolve({ success: false }) };
      }
      if (isFlowAdminOnly(flowManager.getBotCommands(), flowId) && !(await botFlowAdminAllowed(platform, userId, chatId))) {
        sendLog(`[Flow] ${name} flow ${flowId} refused for user ${userId} in chat ${chatId} — limited to the owner in a private chat`);
        return {
          taskId: createTaskId(),
          result: Promise.resolve({
            success: false,
            error: 'Flow command limited to admins',
            displayError: t(getLangCache(), 'bot.chat.flowNotAllowed'),
          }),
        };
      }
      if (!(await botFlowAllowed(platform, flowId, userId, chatId))) {
        sendLog(`[Flow] ${name} flow ${flowId} refused for user ${userId} — no download grant`);
        return {
          taskId: createTaskId(),
          result: Promise.resolve({
            success: false,
            error: 'Downloader not granted',
            displayError: botAccessDeniedText(getLangCache(), 'download'),
          }),
        };
      }
      const extraContext: Record<string, string> = {
        [inputVariable]: input,
        'bot.triggerChatId': chatId,
        'bot.triggerUserId': userId,
        'bot.triggerPlatform': platform,
        // The send step quotes it (Discord) or answers in its thread (Slack), as chat replies do.
        ...(messageId ? { 'bot.triggerMessageId': messageId } : {}),
        [BOT_MODEL_VARIABLE]: resolveLlmDirectTarget(config[platform].llmDirect, getHiddenSources()).targetUrl,
      };
      const execution = flowManager.queueExecutionWithId(flowId, extraContext, 'bot');
      sendLog(`[Flow] ${name} command triggered flow ${flowId} for user ${userId} with input: ${input}`);
      return execution;
    },
  };
}
