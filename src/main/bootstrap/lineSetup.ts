import { IPC } from '../../shared/types';
import { BOT_MODEL_VARIABLE } from '../../shared/builtinFlows';
import {
  botAccessDeniedText,
  botBuiltinAllowed,
  botChatAllowed,
  botDownloadAllowed,
  botFlowAdminAllowed,
  botFlowAllowed,
  isBotGroupPending,
  isBotUserBlocked,
  notifyBotGroupJoined,
} from '../botPermissions';
import { markBotReachable, markBotUnreachable, recordBotContact, recordBotUse } from '../botDirectory';
import { config, getHiddenSources } from '../config';
import { resolveLlmDirectTarget } from '../providerCommands';
import { sendLog, sendToRenderer, createTaskId } from '../helpers';
import { getLangCache, t } from '../i18n';
import { isFlowAdminOnly } from '../../shared/botCommandAccess';
import { LineRuntime } from '../line';
import { consumeLinePairingCode, isLinePairedUser, setLineRuntimeSnapshot } from '../lineBridge';
import { clearBotConversation } from '../botConversations';
import { resolveBotCommands } from './botCommands';
import {
  botChatKey,
  clearPendingAgentAsk,
  hasPendingAgentAsk,
  resumeBotAgentAsk,
  runBotBuiltinCommand,
  takePendingAgentAsk,
} from '../botBuiltinCommands';
import type { FlowManager } from '../flow';

export function createLineRuntime(deps: {
  getFlowManager: () => FlowManager | null;
}): LineRuntime {
  const { getFlowManager } = deps;

  return new LineRuntime({
    getEnabled: () => config.line.enabled,
    getChannelAccessToken: () => config.line.channelAccessToken,
    getChannelSecret: () => config.line.channelSecret,
    getPort: () => config.line.port,
    isPairedUser: (userId) => isLinePairedUser(userId),
    consumePairingCode: (code, user) => consumeLinePairingCode(code, user),
    getLlmDirect: () => resolveLlmDirectTarget(config.line.llmDirect, getHiddenSources()),
    getProviderCommands: () => resolveBotCommands(getFlowManager).providers,
    getByokCommands: () => resolveBotCommands(getFlowManager).byok,
    getBuiltinCommands: () => resolveBotCommands(getFlowManager).builtins,
    onBuiltinCommand: (key, input, targetUrl, chatId, userId) => runBotBuiltinCommand(
      { getFlowManager, getStrings: getLangCache },
      { key, input, targetUrl, chatKey: botChatKey('line', chatId, userId) },
    ),
    canUseBuiltin: (key, chatId, userId) => botBuiltinAllowed('line', key, userId, chatId),
    canUseDownloader: (chatId, userId) => botDownloadAllowed('line', userId, chatId),
    canChat: (chatId, userId) => botChatAllowed('line', userId, chatId),
    isFlowAdmin: (chatId, userId) => botFlowAdminAllowed('line', userId, chatId),
    isBlocked: (userId) => isBotUserBlocked('line', userId),
    isGroupPending: (chatId) => isBotGroupPending('line', chatId),
    onGroupJoined: (group) => {
      if (notifyBotGroupJoined('line', { id: group.chatId, ...(group.title ? { title: group.title } : {}) })) {
        sendLog(`[line] added to ${group.chatKind} ${group.chatId} — waiting for approval in settings`);
      }
    },
    onUse: (user, chatId) => {
      void recordBotUse({ platform: 'line', id: user.userId, ...(user.displayName ? { firstName: user.displayName } : {}) }, chatId)
        .catch(() => undefined);
    },
    onGroupSeen: (group) => {
      void recordBotContact({ platform: 'line', kind: 'chat', id: group.chatId, ...(group.title ? { title: group.title } : {}) })
        .then(() => markBotReachable('line', 'chat', group.chatId))
        .catch(() => undefined);
    },
    onGroupLeft: (chatId) => {
      void markBotUnreachable('line', 'chat', chatId, 'removed').catch(() => undefined);
    },
    onAgentAnswer: async (answer, chatId, userId) => {
      const chatKey = botChatKey('line', chatId, userId);
      const runId = takePendingAgentAsk(chatKey);
      if (!runId) return null;
      return resumeBotAgentAsk({ getFlowManager, getStrings: getLangCache }, { runId, answer, chatKey });
    },
    hasPendingAgentAsk: (chatId, userId) => hasPendingAgentAsk(botChatKey('line', chatId, userId)),
    onDropAgentAsk: (chatId, userId) => clearPendingAgentAsk(botChatKey('line', chatId, userId)),
    onNewConversation: (chatId, userId) => clearBotConversation(botChatKey('line', chatId, userId)),
    onLog: (message) => sendLog(message),
    onRuntime: (snapshot) => {
      setLineRuntimeSnapshot(snapshot);
      sendToRenderer(IPC.LINE_RUNTIME, snapshot);
    },
    getStrings: () => getLangCache(),
    getFlowCommands: () => getFlowManager()?.getBotCommands() ?? [],
    onFlowCommand: async (flowId, inputVariable, input, userId, chatId) => {
      const flowManager = getFlowManager();
      if (!flowManager) {
        return { taskId: createTaskId(), result: Promise.resolve({ success: false }) };
      }
      if (isFlowAdminOnly(flowManager.getBotCommands(), flowId) && !(await botFlowAdminAllowed('line', userId, chatId))) {
        sendLog(`[Flow] LINE flow ${flowId} refused for user ${userId} in chat ${chatId} — limited to the owner in a private chat`);
        return {
          taskId: createTaskId(),
          result: Promise.resolve({
            success: false,
            error: 'Flow command limited to admins',
            displayError: t(getLangCache(), 'line.cmd.flowNotAllowed'),
          }),
        };
      }
      if (!(await botFlowAllowed('line', flowId, userId, chatId))) {
        sendLog(`[Flow] LINE flow ${flowId} refused for user ${userId} — no download grant`);
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
        'bot.triggerPlatform': 'line',
        [BOT_MODEL_VARIABLE]: resolveLlmDirectTarget(config.line.llmDirect, getHiddenSources()).targetUrl,
      };
      const execution = flowManager.queueExecutionWithId(flowId, extraContext, 'bot');
      sendLog(`[Flow] LINE command triggered flow ${flowId} for user ${userId} with input: ${input}`);
      return execution;
    },
  });
}
