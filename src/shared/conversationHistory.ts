import { hasThreadMetaAnchor, parseConversationDoc, stripConversationMarkers, writeThreadMeta } from './conversationDoc';
import type { ConversationHeadingAliases, ThreadMeta } from './conversationDoc';

/**
 * Versions of a conversation file, kept outside the outputs folder under the id in its thread
 * marker. Pure: what counts as a change, what may be addressed, and what a restore writes.
 */

/** A conversation id, as it may appear in a path. */
export const CONVERSATION_ID_RE = /^[A-Za-z0-9-]{6,64}$/;
/** A version id: the save time in ms and a short random suffix. Nothing else is ever a path segment. */
export const VERSION_ID_RE = /^\d{13}-[a-z0-9]{6}$/;
/** Versions kept per conversation; the oldest goes first. */
export const CONVERSATION_VERSION_CAP = 50;
/** Larger text is not a conversation anyone edits by hand; it is not copied. */
export const CONVERSATION_VERSION_MAX_BYTES = 10 * 1024 * 1024;

/** Why the version was kept: the text before an edit in the App, before another app's change, before a restore, before Notion's changes were merged in. */
export type ConversationVersionReason = 'edit' | 'external' | 'restore' | 'notion';
export const CONVERSATION_VERSION_REASONS: readonly ConversationVersionReason[] = ['edit', 'external', 'restore', 'notion'];

export interface ConversationVersionEntry {
  vid: string;
  at: string;
  reason: ConversationVersionReason;
  title: string;
  bytes: number;
}

export type ConversationHistoryList =
  | { status: 'ok'; versions: ConversationVersionEntry[] }
  | { status: 'unversionable' }
  | { status: 'failed' };

export type ConversationRestoreResult =
  | { ok: true; content: string }
  /** `tooLarge`: the text there now is past the version size cap, so it could not be kept first. */
  | { ok: false; reason: 'missing' | 'failed' | 'tooLarge' };

const NO_ALIASES: ConversationHeadingAliases = {
  provider: new Set(), time: new Set(), prompt: new Set(), response: new Set(),
};

const THREAD_MARKER_LINE = /^<!--\s*yobi:thread\s/m;

/**
 * Only a file with a title or a thread marker can carry an id: without either, the marker would
 * become the first line, and the sidebar preview would show a raw HTML comment. A `# ` line inside
 * a code block is not a title.
 */
export function canVersionConversation(raw: string): boolean {
  return hasThreadMetaAnchor(raw);
}

export function isConversationId(value: unknown): value is string {
  return typeof value === 'string' && CONVERSATION_ID_RE.test(value);
}

export function isVersionId(value: unknown): value is string {
  return typeof value === 'string' && VERSION_ID_RE.test(value);
}

export function threadOf(raw: string): ThreadMeta {
  return parseConversationDoc(raw, NO_ALIASES).thread;
}

/** The id in the file's thread marker, when it is one this module could have written. */
export function conversationIdOf(raw: string): string | null {
  const id: unknown = threadOf(raw).id;
  return isConversationId(id) ? id : null;
}

/**
 * The text as a reader sees it. Opening a conversation and switching modes rewrite its markers,
 * and the first marker comes with a blank line, so neither counts as a change.
 */
export function comparableConversationText(raw: string): string {
  return stripConversationMarkers(raw.replace(/\r\n?/g, '\n'))
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line !== '')
    .join('\n');
}

export function sameConversationText(a: string, b: string): boolean {
  return comparableConversationText(a) === comparableConversationText(b);
}

/** `after` is `before` with more at the end: a turn landed, nothing was lost. */
export function isConversationAppend(before: string, after: string): boolean {
  const old = comparableConversationText(before);
  const next = comparableConversationText(after);
  return next.startsWith(old) && (next.length === old.length || next[old.length] === '\n');
}

/** The screen's text is about to be replaced by a change another app made: keep it, unless only a turn was added. */
export function shouldKeepBeforeReload(before: string, after: string): boolean {
  if (!before.trim() || sameConversationText(before, after)) return false;
  return !isConversationAppend(before, after);
}

/**
 * The file with its id in the thread marker, the id given when it had none. Null for a file that
 * cannot carry one.
 */
export function withConversationId(raw: string, newId: () => string): { raw: string; id: string } | null {
  const existing = conversationIdOf(raw);
  if (existing) return { raw, id: existing };
  if (!canVersionConversation(raw)) return null;
  const id = newId();
  return { raw: writeThreadMeta(raw, { ...threadOf(raw), id, v: 1 }), id };
}

/** A copy of a conversation starts its own history: the id is dropped. */
export function withoutConversationId(raw: string): string {
  if (!THREAD_MARKER_LINE.test(raw)) return raw;
  const thread = threadOf(raw);
  if (!('id' in thread)) return raw;
  const { id: _dropped, ...rest } = thread;
  return writeThreadMeta(raw, rest);
}

/** A whole marker written from an older read keeps the id the file has now. */
export function keepConversationId(current: string, thread: ThreadMeta): ThreadMeta {
  const id = conversationIdOf(current);
  return id ? { ...thread, id } : thread;
}

/**
 * The thread marker a restored version is written with. The provider's own thread and the rolling
 * summary no longer match the file, so the next turn replays it; the id and the conversation's modes
 * stay as they are now.
 */
export function threadAfterRestore(version: ThreadMeta, current: ThreadMeta): ThreadMeta {
  const {
    threadUrl: _url, threadTurns: _turns, threadAt: _at, summary: _summary, summarizedTurns: _covered,
    id: _id, mcp: _mcp, web: _web, agent: _agent, notion: _notion, ...rest
  } = version;
  return {
    ...rest,
    // A Notion document stays linked to the page it is now; restoring old text does not unlink it.
    ...(current.notion !== undefined ? { notion: current.notion } : {}),
    ...(current.mcp !== undefined ? { mcp: current.mcp } : {}),
    ...(current.web !== undefined ? { web: current.web } : {}),
    ...(current.agent !== undefined ? { agent: current.agent } : {}),
    ...(isConversationId(current.id) ? { id: current.id } : {}),
    v: 1,
  };
}

/** The version's text as it goes back into the file. */
export function restoredConversation(version: string, current: string): string {
  return writeThreadMeta(version, threadAfterRestore(threadOf(version), threadOf(current)));
}

function isEntry(value: unknown): value is ConversationVersionEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return isVersionId(entry.vid)
    && typeof entry.at === 'string'
    && CONVERSATION_VERSION_REASONS.includes(entry.reason as ConversationVersionReason)
    && typeof entry.title === 'string'
    && typeof entry.bytes === 'number';
}

/** The index file's entries, oldest first; anything malformed is dropped rather than trusted. */
export function parseVersionIndex(value: unknown): ConversationVersionEntry[] {
  const list: unknown = value && typeof value === 'object' ? (value as { versions?: unknown }).versions : null;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  return list.filter(isEntry).filter((entry) => !seen.has(entry.vid) && Boolean(seen.add(entry.vid)));
}

export type RestoreBlock = 'sending' | 'awaiting' | 'editing' | 'translating';

/**
 * Why a version cannot go back right now: an answer is being written into the file, the agent is
 * waiting for the user's reply (its answer lands in this file), an answer is open in the editor
 * (its save would then conflict), or an answer is being translated (the translation is saved
 * against the answer it started from).
 */
export function restoreBlockReason(state: {
  pending: number;
  awaiting: boolean;
  draftOpen: boolean;
  translating?: boolean;
}): RestoreBlock | null {
  if (state.pending > 0) return 'sending';
  if (state.awaiting) return 'awaiting';
  if (state.draftOpen) return 'editing';
  if (state.translating) return 'translating';
  return null;
}

/** A new version id for a save at `now`. */
export function makeVersionId(now: number, random: () => number = Math.random): string {
  const suffix = Array.from({ length: 6 }, () => '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(random() * 36)]).join('');
  return `${String(Math.max(0, Math.floor(now))).padStart(13, '0').slice(-13)}-${suffix}`;
}
