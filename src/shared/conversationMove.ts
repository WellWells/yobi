/*
 * Moving conversation files between the outputs folder and its folders. Main does the move
 * (`src/main/conversationMove.ts`); the renderer only re-keys what it holds by path. Pure.
 */

/** Why a conversation cannot be moved right now: something is about to write to it, or waits on it. */
export type ConversationBusyReason =
  | 'sending'
  | 'search'
  | 'agent'
  | 'agentAwaiting'
  | 'flowCommand'
  | 'translating'
  | 'notion';

export interface ConversationMove {
  from: string;
  to: string;
}

export type ConversationMoveOutcome =
  | { from: string; status: 'moved'; to: string }
  /** Already in that folder: nothing was done. */
  | { from: string; status: 'unchanged' }
  | { from: string; status: 'busy'; reason: ConversationBusyReason }
  | { from: string; status: 'missing' }
  /** Not a conversation file inside the outputs folder. */
  | { from: string; status: 'invalid' }
  | { from: string; status: 'failed'; error: string };

export interface ConversationMoveResult {
  /** One per path asked for, in the same order. */
  outcomes: ConversationMoveOutcome[];
  /** The target is not the outputs folder or one folder directly inside it: nothing was moved. */
  error?: 'invalidTarget';
}

/** Broadcast after any move, before the refreshed file list. */
export interface ConversationMovedEvent {
  moves: ConversationMove[];
}

/** One spelling per file, so a path main resolved and one the list gave compare equal. */
export function conversationMoveKey(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLowerCase();
}

/** Where `filePath` went, or null when it is not among the moves. */
export function movedPathFor(moves: readonly ConversationMove[], filePath: string | null | undefined): string | null {
  if (!filePath) return null;
  const key = conversationMoveKey(filePath);
  return moves.find((move) => conversationMoveKey(move.from) === key)?.to ?? null;
}

/** The file name at the end of a path, either separator. */
export function baseNameOf(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] ?? filePath;
}
