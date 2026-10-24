import type { ConversationBusyReason } from '../shared/conversationMove';
import { conversationPathKey } from './conversationPaths';
import { learnConversationId } from './conversationIndex';

/*
 * Which conversation files something is about to write to. A move refuses these: a send that
 * finds its file gone does not fail, it quietly starts a new file at the top of the list, and the
 * answer the user is waiting for lands outside the folder they just put the conversation in.
 * Memory only; a question an Agent run left waiting is read from its run file instead.
 */

export type { ConversationBusyReason } from '../shared/conversationMove';

const holders = new Map<string, Map<symbol, ConversationBusyReason>>();

/** Marks the file busy until the returned function is called; calling it again does nothing. */
export function markConversationBusy(
  filePath: string | null | undefined,
  reason: ConversationBusyReason,
): () => void {
  if (!filePath) return () => {};
  // Read its id now: if the file is moved outside Yobi before the answer lands, the id finds it.
  learnConversationId(filePath);
  const key = conversationPathKey(filePath);
  const token = Symbol(reason);
  const entry = holders.get(key) ?? new Map<symbol, ConversationBusyReason>();
  entry.set(token, reason);
  holders.set(key, entry);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = holders.get(key);
    if (!current) return;
    current.delete(token);
    if (current.size === 0) holders.delete(key);
  };
}

/** The latest reason the file is busy, or null. */
export function conversationBusyReason(filePath: string): ConversationBusyReason | null {
  const entry = holders.get(conversationPathKey(filePath));
  if (!entry) return null;
  let latest: ConversationBusyReason | null = null;
  for (const reason of entry.values()) latest = reason;
  return latest;
}

/** Runs `work` with the file marked busy, released however it ends. */
export async function whileConversationBusy<T>(
  filePath: string | null | undefined,
  reason: ConversationBusyReason,
  work: () => Promise<T>,
): Promise<T> {
  const release = markConversationBusy(filePath, reason);
  try {
    return await work();
  } finally {
    release();
  }
}

/** Holds the mark until `pending` settles; returns it unchanged. */
export function busyUntilSettled<T>(
  filePath: string | null | undefined,
  reason: ConversationBusyReason,
  pending: Promise<T>,
): Promise<T> {
  const release = markConversationBusy(filePath, reason);
  pending.then(release, release);
  return pending;
}
