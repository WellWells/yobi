import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import type { ConversationMoveOutcome, ConversationMoveResult } from '../../shared/conversationMove';
import { MOVE_MAX_FILES, moveConversations } from '../conversationMove';
import { isAllowedFilePath } from './context';

/**
 * `folder`: '' for the outputs folder, or the name (or full path) of a folder directly in it.
 * Only paths inside outputs reach the move; any other is reported `invalid` and left alone.
 */
export async function handleConversationMove(paths: unknown, folder: unknown): Promise<ConversationMoveResult> {
  if (!Array.isArray(paths) || typeof folder !== 'string') return { outcomes: [], error: 'invalidTarget' };
  const rejected = new Map<number, ConversationMoveOutcome>();
  const allowed: string[] = [];
  const order: Array<string | number> = [];
  for (const [index, candidate] of paths.slice(0, MOVE_MAX_FILES).entries()) {
    if (typeof candidate === 'string' && candidate && await isAllowedFilePath(candidate)) {
      allowed.push(candidate);
      order.push(candidate);
    } else {
      rejected.set(index, { from: typeof candidate === 'string' ? candidate : '', status: 'invalid' });
      order.push(index);
    }
  }
  const result = await moveConversations(allowed, folder);
  if (result.error) return result;
  // Back in the order asked for, the refused ones in their places.
  const moved = [...result.outcomes];
  const outcomes = order.map((entry) => (typeof entry === 'number' ? rejected.get(entry)! : moved.shift()!));
  return { outcomes };
}

export function registerConversationMoveHandlers(): void {
  ipcMain.handle(IPC.CONVERSATION_MOVE, (_event, paths: unknown, folder: unknown) => handleConversationMove(paths, folder));
}
