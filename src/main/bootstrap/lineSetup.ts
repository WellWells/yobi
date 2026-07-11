import { IPC } from '../../shared/types';
import { config } from '../config';
import { sendLog, sendToRenderer, sendWebNotification, createTaskId } from '../helpers';
import { getLangCache } from '../i18n';
import { resolveUrlPrompt } from '../urlParser';
import { LineRuntime } from '../line';
import { consumeLinePairingCode, getLinePairedDisplayName, isLinePairedUser, setLineRuntimeSnapshot } from '../lineBridge';
import { resolveBotCommands } from './botCommands';
import type { QueueManager } from '../queueManager';
import type { FlowManager } from '../flow';

export function createLineRuntime(deps: {
  queue: QueueManager;
  getFlowManager: () => FlowManager | null;
}): LineRuntime {
  const { queue, getFlowManager } = deps;

  return new LineRuntime({
    getEnabled: () => config.line.enabled,
    getChannelAccessToken: () => config.line.channelAccessToken,
    getChannelSecret: () => config.line.channelSecret,
    getPort: () => config.line.port,
    isPairedUser: (userId) => isLinePairedUser(userId),
    consumePairingCode: (code, user) => consumeLinePairingCode(code, user),
    onTaskRequest: async (request) => {
      const resolved = await resolveUrlPrompt(request.text, {
        langData: getLangCache(),
        youtubePrompt: config.youtubePrompt,
        onLog: sendLog,
        onNotify: (title, body) => sendWebNotification(title, body, 'info'),
      });
      const id = createTaskId();
      queue.enqueue({
        id,
        prompt: resolved.prompt,
        targetUrl: resolved.forceProviderUrl ?? request.targetUrl ?? config.targetUrl,
        title: resolved.title,
        source: 'line',
        lineReplyTarget: { userId: request.userId, chatId: request.chatId },
        requesterName: getLinePairedDisplayName(request.userId),
      });
      sendLog(`[${id}] LINE message queued`);
      return { taskId: id };
    },
    getLlmDirect: () => config.line.llmDirect,
    getProviderCommands: () => resolveBotCommands(getFlowManager).providers,
    getByokCommands: () => resolveBotCommands(getFlowManager).byok,
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
      // LINE 1:1 chats have no id of their own, so the user is both the chat and
      // the sender — a `bot` step replying to {{bot.triggerChatId}} reaches them.
      const extraContext: Record<string, string> = {
        [inputVariable]: input,
        'bot.triggerChatId': userId,
        'bot.triggerUserId': userId,
        'bot.triggerPlatform': 'line',
      };
      const execution = flowManager.queueExecutionWithId(flowId, extraContext, 'bot');
      sendLog(`[AgentFlow] LINE command triggered flow ${flowId} for user ${userId} with input: ${input}`);
      return execution;
    },
  });
}
