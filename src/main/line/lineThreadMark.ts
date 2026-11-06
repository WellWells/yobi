/**
 * The open-chat thread a stored message starts: `_squareThread` names each thread's first message and LINE's
 * count of its replies, which read, search, around and unread show as thread_id / thread_replies.
 */
import type { ParsedMessage } from './schema';

/** A thread an open-chat message starts, and LINE's count of its replies. */
export interface ThreadRoot {
  thread: string;
  replies: number;
}

export const THREAD_ROOTS_SQL = "SELECT _messageId, _threadMid, _totalMessageCount FROM _squareThread WHERE _messageId<>''";

/** Root message id -> its thread, from the rows of THREAD_ROOTS_SQL. */
export function threadRootsOf(rows: readonly Record<string, unknown>[]): Map<string, ThreadRoot> {
  const roots = new Map<string, ThreadRoot>();
  for (const row of rows) {
    roots.set(String(row._messageId ?? ''), { thread: String(row._threadMid ?? ''), replies: Number(row._totalMessageCount) || 0 });
  }
  return roots;
}

/**
 * Adds thread_id and thread_replies to a message that starts an open-chat thread. A count of 0 is
 * left out, like the other empty fields.
 */
export function markThreadRoot(msg: ParsedMessage, roots: ReadonlyMap<string, ThreadRoot>): ParsedMessage {
  const root = msg.id ? roots.get(msg.id) : undefined;
  if (!root) return msg;
  msg.thread_id = root.thread;
  if (root.replies > 0) msg.thread_replies = root.replies;
  return msg;
}
