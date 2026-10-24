import type { ConversationBusyReason } from '../shared/conversationMove';
import { conversationBusyReason } from './conversationBusy';
import { conversationPathKey } from './conversationPaths';
import { awaitingRunConversations } from './flow/agent/agentRunStore';

/**
 * Why a conversation cannot be moved or deleted right now: something writing to it (memory marks),
 * or an Agent run still waiting for the user's answer (read from the run files, so it holds after
 * a restart). Moves, folder changes and Recently Deleted all ask this one question.
 */
export async function busyReasonReader(now = Date.now()): Promise<(filePath: string) => ConversationBusyReason | null> {
  const awaiting = new Set((await awaitingRunConversations(now)).map(conversationPathKey));
  return (filePath) => conversationBusyReason(filePath)
    ?? (awaiting.has(conversationPathKey(filePath)) ? 'agentAwaiting' : null);
}
