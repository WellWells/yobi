import type { ConversationBusyReason } from '../shared/conversationMove';
import { conversationBusyReason } from './conversationBusy';

/**
 * Why a conversation cannot be moved or deleted right now: something is about to write to it
 * (memory marks). Moves, folder changes and Recently Deleted all ask this one question.
 * A question an Agent run left waiting does not hold its conversation: a move points the run at
 * the new place, and deleting it cancels the run (`cancelAwaitingRunsIn`).
 */
export function busyReasonReader(): (filePath: string) => ConversationBusyReason | null {
  return conversationBusyReason;
}
