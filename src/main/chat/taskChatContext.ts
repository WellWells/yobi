import type { Task } from '../../shared/types';

export interface TaskChatContext {
  /** The reply goes to the incognito view and is never written to disk. */
  temporary: boolean;
  /** The temporary conversation so far is sent as this turn's history. */
  useTemporaryContext: boolean;
  /** The conversation file this turn belongs to, or null for a one-shot / temporary send. */
  conversationPath: string | null;
}

/**
 * Decides, once per task, where its reply goes and what history it may carry, so toggling
 * temporary chat mid-flight cannot split planning from delivery.
 *
 * - Nothing lands on disk while temporary chat is on, hotkey captures included.
 * - Only the desktop composer reads the temporary conversation back; a bot message or hotkey
 *   capture must not see (or send on) the desktop user's private turns.
 * - A temporary question does not resume an open conversation's thread: its reply is discarded,
 *   so the provider thread would get ahead of the file (`threadTurns` exists to prevent that).
 */
export function resolveTaskChatContext(task: Task, tempChatMode: boolean): TaskChatContext {
  const temporary = tempChatMode && !task.replyTarget && !task.lineReplyTarget;
  return {
    temporary,
    useTemporaryContext: temporary && (task.source ?? 'ui') === 'ui',
    conversationPath: temporary ? null : (task.conversationPath ?? null),
  };
}
