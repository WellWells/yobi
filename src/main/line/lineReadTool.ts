/**
 * The line_get_history and line_get_unread tools: argument checks, the read itself (with LINE's server for open chats and
 * threads unless offline), and every note line-cli prints on stderr for them, in its order.
 */
import { LineError } from './errors';
import type { LineReader } from './reader';
import { saneLimit, type ParsedMessage } from './schema';
import { chatFreshness, historyNote, isThreadChat, MAX_READ_THREADS, onlineNotes, staleFor, staleNote, threadsNotReadNote, type ServerHint } from './lineFreshness';
import { limitNote, pageNote, resolvedNote, TOOL_WORDS } from './lineNotes';
import { effectiveReadLimit } from './lineReadRange';
import { readChat, readContext } from './lineOnline';
import { OnlineServer, type SquareCaller } from './lineSquareServer';
import { DEFAULT_UNREAD_CHATS, DEFAULT_UNREAD_PER_CHAT, readUnread, type LineUnreadChat } from './lineUnread';

/** What reaching LINE's server needs; without `connect` an online read reports the server unavailable. */
export interface OnlineDeps {
  connect?: () => Promise<SquareCaller>;
  signal?: AbortSignal;
  now?: () => number;
  notify?: (line: string) => void;
}

export interface ToolOutput<T> {
  value: T;
  notes: string[];
}

/** max_threads: 0 or absent = the default; otherwise 1 to 100. */
export function checkMaxThreads(value: unknown): number {
  if (value === undefined || value === null) return 0;
  const n = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isInteger(n) || n < 0 || n > MAX_READ_THREADS) {
    throw new LineError('INVALID_ARGUMENT', `${TOOL_WORDS.maxThreads} must be between 1 and ${MAX_READ_THREADS}`);
  }
  return n;
}

export interface HistoryArgs {
  chat: string;
  /** Unix seconds, 0 = open. */
  sinceSec: number;
  untilSec: number;
  limit?: number;
  offline: boolean;
  maxThreads: number;
}

function push(notes: string[], note: string): void {
  if (note) notes.push(note);
}

/** A range of one chat (line-cli `read` without --around), with its notes. */
export async function readHistory(reader: LineReader, args: HistoryArgs, deps: OnlineDeps = {}): Promise<ToolOutput<ParsedMessage[]>> {
  const { sinceSec: st, untilSec: ut } = args;
  if (st !== 0 && ut !== 0 && st > ut) throw new LineError('INVALID_ARGUMENT', `${TOOL_WORDS.since} is later than ${TOOL_WORDS.until}`);
  const resolved = reader.resolveChatInfo(args.chat, false);
  const acc = reader.access();
  const server = new OnlineServer({ ...deps, enabled: !args.offline, maxThreads: args.maxThreads });
  const opt = { sinceSec: st, untilSec: ut, limit: args.limit };
  const res = await readChat(readContext(acc), resolved, opt, server);
  const fr = chatFreshness(acc.all, resolved.chat_id);
  const notes: string[] = [];
  push(notes, resolvedNote(args.chat, resolved));
  notes.push(...onlineNotes(server.finalReport()));
  const hint: ServerHint = args.offline ? 'offline' : 'none';
  push(notes, threadsNotReadNote(resolved.chat_id, res.threadsNotRead ?? 0, res.repliesNotRead ?? 0, hint));
  const thread = isThreadChat(resolved.chat_id);
  const ids = res.counted.map((m) => m.id);
  if (!res.complete && fr && staleFor(fr, ut)) {
    notes.push(staleNote(resolved.chat_id, fr, hint));
    // A thread's stale note already says its replies are not stored.
    if (!thread) push(notes, historyNote(resolved.chat_id, fr, ids, st, ut, hint));
  } else if (!res.complete || !thread) {
    push(notes, historyNote(resolved.chat_id, fr, ids, st, ut, hint));
  }
  const next = st !== 0 ? `newer: rerun with ${TOOL_WORDS.since} <last sent_at>` : `older: rerun with ${TOOL_WORDS.until} <first sent_at>`;
  const first = res.counted[0]?.sent_at ?? '';
  const last = res.counted[res.counted.length - 1]?.sent_at ?? '';
  push(notes, pageNote(res.counted.length, effectiveReadLimit(opt), first, last, next));
  return { value: res.messages, notes };
}

export interface UnreadArgs {
  limitChats?: number;
  perChatLimit?: number;
  includeOfficial: boolean;
  includeHidden: boolean;
  offline: boolean;
  /** LINE is not running, so nothing counts as fully synced. */
  lineStopped?: boolean;
}

/** Chats with unread messages and those messages (line-cli `unread`), with its notes. */
export async function readUnreadChats(reader: LineReader, args: UnreadArgs, deps: OnlineDeps = {}): Promise<ToolOutput<LineUnreadChat[]>> {
  const server = new OnlineServer({ ...deps, enabled: !args.offline });
  const entries = await readUnread(
    reader.access(),
    { limitChats: args.limitChats, perChatLimit: args.perChatLimit, includeOfficial: args.includeOfficial, includeHidden: args.includeHidden, lineStopped: args.lineStopped },
    server,
  );
  const notes = onlineNotes(server.finalReport());
  const hint: ServerHint = args.offline ? 'offline' : 'none';
  push(notes, limitNote(entries.length, saneLimit(args.limitChats, DEFAULT_UNREAD_CHATS), `raise ${TOOL_WORDS.limitChats}`));
  let cut = 0;
  for (const e of entries) {
    if (e.more) cut++;
    if (e.chat.stale && e.freshness) notes.push(staleNote(e.chat.chat_id, e.freshness, hint));
  }
  if (cut > 0) {
    const perChat = saneLimit(args.perChatLimit, DEFAULT_UNREAD_PER_CHAT);
    notes.push(
      `note: ${cut} chat(s) have more unread messages than ${TOOL_WORDS.perChatLimit} ${perChat}; raise it or page older with ${TOOL_WORDS.read} with chat_id <chat_id> and ${TOOL_WORDS.until} <first sent_at>`,
    );
  }
  return { value: entries.map((e) => e.chat), notes };
}
