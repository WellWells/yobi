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
 * Decides, once per task, where its reply goes and what history it is allowed to carry.
 *
 * Three separate rules, which used to be one condition evaluated twice:
 *
 * - **Nothing lands on disk while temporary chat is on.** That covers a hotkey capture too:
 *   the user turned the mode on to stop replies being saved, and the hotkey is still them.
 * - **Only the desktop composer reads the temporary conversation back.** A Telegram or LINE
 *   message answered while the mode is on used to be planned against the desktop user's
 *   private turns and sent them to somebody else; a hotkey capture became a continuation of
 *   them, which is not what "the hotkey is one-shot" means.
 * - **A temporary question does not resume an open conversation's thread.** Its reply is
 *   discarded, so the provider thread would end up a turn ahead of the file meant to mirror
 *   it — the divergence `threadTurns` exists to prevent.
 *
 * Sampling all of it once also means toggling the mode mid-flight can no longer split
 * planning from delivery: a task that started temporary stays temporary for its whole life.
 */
export function resolveTaskChatContext(task: Task, tempChatMode: boolean): TaskChatContext {
  const temporary = tempChatMode && !task.replyTarget && !task.lineReplyTarget;
  return {
    temporary,
    useTemporaryContext: temporary && (task.source ?? 'ui') === 'ui',
    conversationPath: temporary ? null : (task.conversationPath ?? null),
  };
}
