import { config } from './config';
import { listOutputFiles } from './files';
import { discardEmptyConversation } from './output';
import { sendToRenderer, sendWebNotification } from './helpers';
import { getLangCache, localizeUserFacingError, t } from './i18n';
import { TaskHardTimeoutError } from './queueManager';
import { IPC } from '../shared/types';
import type { ChatTurnEvent, Task } from '../shared/types';
import type { TelegramRuntime } from './telegram';
import type { LineRuntime } from './line';

export interface TaskReportDeps {
  telegramRuntime: TelegramRuntime;
  lineRuntime: LineRuntime;
}

const remotelyReported = new WeakSet<Task>();
const locallyNotified = new WeakSet<Task>();
const chatTurnReported = new WeakSet<Task>();

export function claimChatTurnReport(task: Task): boolean {
  if (!task.sendId) return false;
  if (chatTurnReported.has(task)) return false;
  chatTurnReported.add(task);
  return true;
}

export function claimRemoteReply(task: Task): boolean {
  if (!task.replyTarget && !task.lineReplyTarget) return false;
  if (remotelyReported.has(task)) return false;
  remotelyReported.add(task);
  return true;
}

export function claimLocalNotification(task: Task): boolean {
  if (locallyNotified.has(task)) return false;
  locallyNotified.add(task);
  return true;
}

export function reportChatTurnFailure(task: Task, message: string): void {
  if (!claimChatTurnReport(task)) return;
  sendToRenderer(IPC.CHAT_TURN, {
    sendId: task.sendId ?? '',
    conversationPath: task.conversationPath ?? '',
    phase: 'error',
    error: message,
  } satisfies ChatTurnEvent);

  const { conversationPath } = task;
  if (!conversationPath) return;
  void discardEmptyConversation(conversationPath).then(async (removed) => {
    if (removed) sendToRenderer(IPC.FILE_LIST, await listOutputFiles());
  });
}

export async function replyRemoteError(
  task: Task,
  deps: TaskReportDeps,
  payload: { providerLabel: string; message: string },
): Promise<void> {
  if (!claimRemoteReply(task)) return;
  if (task.replyTarget) await deps.telegramRuntime.sendTaskError(task.replyTarget, payload);
  if (task.lineReplyTarget) await deps.lineRuntime.sendTaskError(task.lineReplyTarget.chatId, payload);
}

export async function notifyQueueLevelFailure(
  task: Task,
  err: unknown,
  deps: TaskReportDeps,
  providerLabelFor: (targetUrl: string) => string,
  onLog: (message: string) => void,
): Promise<void> {
  const strings = getLangCache();
  const message = err instanceof TaskHardTimeoutError
    ? t(strings, 'main.error.taskTimeout', { minutes: String(err.timeoutMinutes) })
    : localizeUserFacingError(err instanceof Error ? err.message : String(err), strings);

  onLog(`[${task.id}] ❌ ${message}`);
  reportChatTurnFailure(task, message);

  if (!task.replyTarget && !task.lineReplyTarget) {
    if (config.notifyEvents.chatFailure && claimLocalNotification(task)) {
      sendWebNotification(t(strings, 'notify.chat.failure.title'), message, 'error');
    }
    return;
  }

  const providerLabel = providerLabelFor(task.targetUrl ?? config.targetUrl);
  try {
    await replyRemoteError(task, deps, { providerLabel, message });
  } catch (notifyErr: unknown) {
    onLog(`[${task.id}] ⚠️ failed to report the queue-level failure: ${(notifyErr as Error).message}`);
  }
}
