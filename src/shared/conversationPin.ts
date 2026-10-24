import { parseConversationDoc, removeThreadMeta, writeThreadMeta } from './conversationDoc';
import type { ConversationHeadingAliases, ThreadMeta } from './conversationDoc';

/*
 * Pinning a conversation is one flag in its thread marker (`pinned: true`). Nothing else in the
 * file moves: the sidebar's order and times come from the turns, never from the file's mtime, so
 * pinning or unpinning does not lift a conversation in the list.
 */

const NO_ALIASES: ConversationHeadingAliases = {
  provider: new Set(), time: new Set(), prompt: new Set(), response: new Set(),
};

function threadMetaOf(raw: string): ThreadMeta {
  return parseConversationDoc(raw, NO_ALIASES).thread;
}

export function isConversationPinned(raw: string): boolean {
  return threadMetaOf(raw).pinned === true;
}

/**
 * `writeThreadMeta` joins with LF, but a file without an H1 comes back with its own CRLF after the
 * new marker line, so every ending is normalised rather than every LF converted. A CRLF file keeps
 * its line endings.
 */
function withLineEndingsOf(original: string, next: string): string {
  return original.includes('\r\n') ? next.replace(/\r?\n/g, '\r\n') : next;
}

/**
 * The file with its pin set, or null when it already says so (nothing to write). Unpinning a
 * marker that carried nothing else takes the marker out again, so pin then unpin gives back the
 * file as it was.
 */
export function setConversationPinned(raw: string, pinned: boolean): string | null {
  const thread = threadMetaOf(raw);
  if ((thread.pinned === true) === pinned) return null;
  // The marker's other keys keep their order, so unpinning writes back the line it read.
  if (pinned) return withLineEndingsOf(raw, writeThreadMeta(raw, { ...thread, pinned: true }));
  const { pinned: _previous, ...rest } = thread;
  const onlyVersion = Object.keys(rest).every((key) => key === 'v');
  return withLineEndingsOf(raw, onlyVersion ? removeThreadMeta(raw) : writeThreadMeta(raw, rest));
}

/**
 * A whole marker written from an older read (a turn landing, a send that began before the user
 * pinned) keeps the pin the file has now: the pin is the user's, not the send's.
 */
export function keepPinState(current: string, thread: ThreadMeta): ThreadMeta {
  const { pinned: _stale, ...rest } = thread;
  return isConversationPinned(current) ? { ...rest, pinned: true } : rest;
}

/** A copy of a conversation (an import) starts unpinned. */
export function withoutPin(raw: string): string {
  return setConversationPinned(raw, false) ?? raw;
}
