import { IPC } from '../../shared/types';
import { botBuiltinAllowed } from '../botPermissions';
import { config, getHiddenSources } from '../config';
import { resolveLlmDirectTarget } from '../providerCommands';
import { sendLog, sendToRenderer, createTaskId } from '../helpers';
import { getLangCache } from '../i18n';
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
    onFlowCommand: async (flowId, inputVariable, input, userId) => {
      const flowManager = getFlowManager();
      if (!flowManager) {
        return { taskId: createTaskId(), result: Promise.resolve({ success: false }) };
      }
      const extraContext: Record<string, string> = {
        [inputVariable]: input,
        'bot.triggerChatId': userId,
        'bot.triggerUserId': userId,
        'bot.triggerPlatform': 'line',
      };
      const execution = flowManager.queueExecutionWithId(flowId, extraContext, 'bot');
      sendLog(`[Flow] LINE command triggered flow ${flowId} for user ${userId} with input: ${input}`);
      return execution;
    },
  });
}
