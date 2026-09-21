import { config } from './config';
import { listOutputFiles } from './files';
import { discardEmptyConversation } from './output';
import { sendToRenderer, sendWebNotification } from './helpers';
import { getLangCache, localizeUserFacingError, t } from './i18n';
import { TaskHardTimeoutError, TaskSkippedError } from './queueManager';
import { deleteTempAttachments } from './telegram/fileDownload';
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

/**
 * A task removed from the queue before it ever ran.
 *
 * The renderer's "thinking" bubble is only ever cleared by an IPC.CHAT_TURN, and the queue
 * state carries no sendId to reconcile against, so a cancel that reported nothing left the
 * bubble spinning until the app restarted. Bot tasks have no sendId and so report nothing,
 * which is what `reportChatTurnFailure` already decides for us. Either way the task still
 * owns whatever temporary files were staged for it.
 */
export function handleDiscardedTask(task: Task): void {
  reportChatTurnFailure(task, t(getLangCache(), 'main.error.taskCancelled'));
  if (task.ephemeralAttachments && task.attachments?.length) {
    void deleteTempAttachments(task.attachments);
  }
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

/**
 * Neither giving up on a task nor skipping it can actually stop the provider automation, so
 * both messages say what really happened rather than implying the work was cancelled.
 */
function queueFailureMessage(err: unknown, strings: Record<string, string>): string {
  if (err instanceof TaskHardTimeoutError) {
    return t(strings, 'main.error.taskTimeout', { minutes: String(err.timeoutMinutes) });
  }
  if (err instanceof TaskSkippedError) return t(strings, 'main.error.taskSkipped');
  return localizeUserFacingError(err instanceof Error ? err.message : String(err), strings);
}

export async function notifyQueueLevelFailure(
  task: Task,
  err: unknown,
  deps: TaskReportDeps,
  providerLabelFor: (targetUrl: string) => string,
  onLog: (message: string) => void,
): Promise<void> {
  const strings = getLangCache();
  const message = queueFailureMessage(err, strings);

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
