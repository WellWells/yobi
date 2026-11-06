/**
 * Reading a chat with what LINE for PC does not store:
 * a thread (t…) with its replies, and an open chat (m…) with the messages after the newest stored
 * one and the replies of its threads active in the span, all read from LINE's server and merged in
 * by time. Without the server (offline, or it cannot be reached) a read gives what this PC stores.
 */
import type { ChatSummary, ReaderAccess } from './reader';
import { MAX_LIMIT, parseMessageRow, saneLimit, type ParsedMessage } from './schema';
import { markThreadRoot, type ThreadRoot } from './lineThreadMark';
import { freshness, isBehind, STALE_SLACK_MS, timeIso, type Freshness } from './lineFreshness';
import { effectiveReadLimit, inSpan, limitTimed, pageSpan, rangeMs, readRange, sortTimed, type RangeOptions, type Timed } from './lineReadRange';
import { SquareError, SQUARE_PAGE_SIZE, type SquareMessage } from './lineSquare';
import type { OnlineServer, ThreadMeta } from './lineSquareServer';

/** The threads one read of an open chat fetches by default (max_threads). */
export const DEFAULT_READ_THREADS = 20;
/** Caps the calls spent on an open chat's messages after the newest stored one. */
export const MAX_GAP_PAGES = 50;
/** Absorbs the gap between LINE's record of a chat's last activity and the last event's createdTime (a few ms). */
const LAST_EVENT_SLACK_MS = 1000;

/** A read's output for a range of one chat. */
export interface ReadResult {
  messages: ParsedMessage[];
  /** What `limit` counts: an open chat's own messages, every message of other chats. */
  counted: ParsedMessage[];
  /** LINE's server filled in what this PC lacks in the span read, so notes about activity that is not stored do not apply. */
  complete: boolean;
  /** An open chat read from this PC alone: the threads with replies in the span, and those replies. */
  threadsNotRead?: number;
  repliesNotRead?: number;
}

/** What turning rows (stored or from the server) into output needs, read once per tool call. */
export interface ReadContext {
  acc: ReaderAccess;
  parse: (row: Record<string, unknown>) => ParsedMessage;
  contacts: Map<string, string>;
  own: Set<string>;
  roots: Map<string, ThreadRoot>;
}

export function readContext(acc: ReaderAccess): ReadContext {
  return { acc, parse: acc.parser(), contacts: acc.contacts(), own: acc.ownMids(), roots: acc.threadRoots() };
}

function online(server: OnlineServer | null): server is OnlineServer {
  return server?.opt.enabled === true;
}

function createdOf(m: SquareMessage): number {
  return m.row._createdTime ?? 0;
}

/**
 * The output of a message read from LINE's server, as a read would show it had LINE stored it: a
 * reply of `thread`, or (thread '') an open chat's own message, marked when it starts a thread
 * LINE for PC knows of.
 */
export function squareToMessage(ctx: ReadContext, m: SquareMessage, thread: string): ParsedMessage {
  const msg = parseMessageRow(m.row, ctx.contacts, ctx.own);
  msg.id = m.id;
  if (thread) msg.thread_id = thread;
  else markThreadRoot(msg, ctx.roots);
  return msg;
}

/** Whether LINE counts a message read from its server as unread: not unsent (events are not messages there). */
export function plainSquare(m: SquareMessage): boolean {
  return m.row._attribute !== 1;
}

/**
 * Reads a range of a resolved chat. With the server (enabled), a thread comes with its replies, and
 * an open chat with its threads' replies and the messages after the newest stored one; otherwise,
 * or when the server cannot be reached, only what this PC stores.
 */
export async function readChat(ctx: ReadContext, chat: ChatSummary, opt: RangeOptions, server: OnlineServer | null): Promise<ReadResult> {
  if (chat.type === 'thread') return readThreadChat(ctx, chat, opt, server);
  if (chat.type === 'open' && online(server)) return readOpenChat(ctx, chat, opt, server);
  return readStored(ctx, chat, opt);
}

/** A range from this PC alone; for an open chat, also what that leaves out, since the output looks complete. */
function readStored(ctx: ReadContext, chat: ChatSummary, opt: RangeOptions): ReadResult {
  const timed = readRange(ctx.acc, chat.chat_id, opt);
  const messages = timed.map((t) => t.msg);
  const res: ReadResult = { messages, counted: messages, complete: false };
  if (chat.type !== 'open') return res;
  let { lo, hi } = rangeMs(opt.sinceSec, opt.untilSec);
  if (timed.length > 0 && timed.length === effectiveReadLimit(opt)) {
    ({ lo, hi } = pageSpan(lo, hi, timed[0].created, timed[timed.length - 1].created, opt.sinceSec !== 0));
  }
  const threads = threadsInSpan(ctx, chat.chat_id, lo, hi).filter((t) => t.replies > 0);
  res.threadsNotRead = threads.length;
  res.repliesNotRead = threads.reduce((sum, t) => sum + t.replies, 0);
  return res;
}

function threadMetaOf(row: Record<string, unknown>, id: string, chat: string): ThreadMeta {
  return {
    id,
    chat,
    rootId: String(row.root ?? ''),
    lastAt: Number(row.lastAt) || 0,
    replies: Number(row.replies) || 0,
    rootAt: Number(row.rootAt) || 0,
  };
}

const THREAD_COLUMNS = 't._messageId AS root, coalesce(t._lastMessageAt,0) AS lastAt, coalesce(t._totalMessageCount,0) AS replies, coalesce(m._createdTime,0) AS rootAt';

function threadMeta(ctx: ReadContext, threadId: string): ThreadMeta {
  const rows = ctx.acc.all(`SELECT t._chatMid AS chat, ${THREAD_COLUMNS} FROM _squareThread t LEFT JOIN _message m ON m._id=t._messageId WHERE t._threadMid=?`, [threadId]);
  const row = rows.at(-1);
  return row ? threadMetaOf(row, threadId, String(row.chat ?? '')) : threadMetaOf({}, threadId, '');
}

/** An open chat's threads with replies that may fall in [lo, hi] (0 = open), most recently active first. */
function threadsInSpan(ctx: ReadContext, chatId: string, lo: number, hi: number): ThreadMeta[] {
  return ctx.acc
    .all(
      `SELECT t._threadMid AS id, ${THREAD_COLUMNS} FROM _squareThread t LEFT JOIN _message m ON m._id=t._messageId
 WHERE t._chatMid=? AND (t._lastMessageAt IS NULL OR t._lastMessageAt>=?) AND (?=0 OR m._createdTime IS NULL OR m._createdTime<=?)
 ORDER BY t._lastMessageAt DESC, t._threadMid`,
      [chatId, lo, hi, hi],
    )
    .map((row) => threadMetaOf(row, String(row.id ?? ''), chatId));
}

/** One stored message and its _createdTime. */
function messageById(ctx: ReadContext, id: string): Timed | null {
  const row = ctx.acc.all('SELECT * FROM _message WHERE _id=?', [id])[0];
  return row ? { msg: ctx.parse(row), created: Number(row._createdTime) || 0, main: false } : null;
}

/**
 * A thread: the message that starts it and the replies stored on this PC (rarely any), plus,
 * online, every reply from LINE's server.
 */
async function readThreadChat(ctx: ReadContext, chat: ChatSummary, opt: RangeOptions, server: OnlineServer | null): Promise<ReadResult> {
  const t = threadMeta(ctx, chat.chat_id);
  if (!t.chat) t.chat = chat.parent_chat_id ?? '';
  const all: Timed[] = [];
  const seen = new Set<string>();
  const add = (msg: ParsedMessage, created: number): void => {
    const id = msg.id ?? '';
    if (seen.has(id)) return;
    seen.add(id);
    all.push({ msg, created, main: false });
  };
  if (t.rootId) {
    const root = messageById(ctx, t.rootId);
    if (root) add(root.msg, root.created);
  }
  for (const local of readRange(ctx.acc, chat.chat_id, { sinceSec: opt.sinceSec, untilSec: opt.untilSec, limit: MAX_LIMIT })) {
    local.msg.thread_id = chat.chat_id;
    add(local.msg, local.created);
  }
  let complete = false;
  if (online(server)) {
    if (!t.chat) {
      server.report.failed.push(`${chat.chat_id}: its open chat is not on this PC`);
    } else {
      server.notify(`reading thread ${chat.chat_id} from LINE's server`);
      const { replies, err } = await server.thread(t, rangeMs(opt.sinceSec, opt.untilSec).lo);
      if (err instanceof SquareError) {
        server.failed(chat.chat_id, err);
      } else if (!err) {
        server.report.threads++;
        complete = true;
      }
      for (const m of replies) add(squareToMessage(ctx, m, t.id), createdOf(m));
    }
  }
  const { lo, hi } = rangeMs(opt.sinceSec, opt.untilSec);
  const span = inSpan(all, lo, hi);
  sortTimed(span);
  const messages = limitTimed(span, effectiveReadLimit(opt), opt.sinceSec !== 0).map((x) => x.msg);
  return { messages, counted: messages, complete };
}

/**
 * An open chat online: the stored messages, the ones after the newest stored message when LINE
 * knows of later activity, and the replies of the threads active in the span.
 */
async function readOpenChat(ctx: ReadContext, chat: ChatSummary, opt: RangeOptions, server: OnlineServer): Promise<ReadResult> {
  let complete = true;
  let all = readRange(ctx.acc, chat.chat_id, opt).map((t) => ({ ...t, main: true }));
  const mainCount = all.length;
  const f = freshness(ctx.acc.all, chat.chat_id);
  let { lo, hi } = rangeMs(opt.sinceSec, opt.untilSec);
  const limit = effectiveReadLimit(opt);
  const fromSince = opt.sinceSec !== 0;
  // Messages that start a thread LINE for PC has no row for: the thread id comes from the server,
  // and the reply count once the thread is read.
  const fresh = new Map<string, string>();
  // A page that `since` already fills ends before the missing messages; the next page reads them.
  if (f && isBehind(f) && (hi === 0 || hi > f.newestStored) && lo <= f.lastActivity && !(fromSince && mainCount === limit)) {
    const gap = await readGap(ctx, server, chat.chat_id, f, lo, hi);
    complete = gap.complete;
    for (const m of gap.messages) {
      const msg = squareToMessage(ctx, m, '');
      if (!msg.thread_id && m.threadRoot && m.threadMid) fresh.set(msg.id ?? '', m.threadMid);
      all.push({ msg, created: createdOf(m), main: true });
    }
  }
  sortTimed(all);
  all = limitTimed(all, limit, fromSince);
  const counted = all.map((t) => t.msg);
  // The span the open chat's own messages cover: the asked range, narrowed to the page when the
  // limit cut it, so thread replies follow the same pages.
  if (all.length > 0 && all.length === limit) {
    ({ lo, hi } = pageSpan(lo, hi, all[0].created, all[all.length - 1].created, fromSince));
  }
  let threads = threadsInSpan(ctx, chat.chat_id, lo, hi);
  const known = new Set(threads.map((t) => t.id));
  const rootAt = new Map<string, number>(); // thread -> index of its root in all
  const newer: ThreadMeta[] = [];
  for (let i = all.length - 1; i >= 0; i--) {
    const th = fresh.get(all[i].msg.id ?? '');
    if (th && !known.has(th)) {
      known.add(th);
      rootAt.set(th, i);
      newer.push({ id: th, chat: chat.chat_id, rootId: all[i].msg.id ?? '', lastAt: 0, replies: 0, rootAt: all[i].created });
    }
  }
  threads = [...newer, ...threads];
  const n = saneLimit(server.opt.maxThreads, DEFAULT_READ_THREADS);
  if (threads.length > n) {
    server.report.threadsLeft += threads.length - n;
    threads = threads.slice(0, n);
  }
  const seen = new Set(all.map((t) => t.msg.id ?? ''));
  for (const [i, t] of threads.entries()) {
    if (!server.isDown()) server.notify(`reading thread ${i + 1}/${threads.length} (${t.id}) from LINE's server`);
    const idx = rootAt.get(t.id);
    // A thread this PC has no record of is read whole, for its reply count.
    const { replies, err } = await server.thread(t, idx !== undefined ? 0 : lo);
    if (err instanceof SquareError) {
      server.failed(t.id, err);
      continue;
    }
    if (err) {
      complete = false;
    } else {
      server.report.threads++;
      if (idx !== undefined) {
        all[idx].msg.thread_id = t.id;
        if (replies.length > 0) all[idx].msg.thread_replies = replies.length;
      }
    }
    for (const m of replies) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      all.push({ msg: squareToMessage(ctx, m, t.id), created: createdOf(m), main: false });
    }
  }
  all = inSpan(all, lo, hi);
  sortTimed(all);
  return { messages: all.map((t) => t.msg), counted, complete };
}

function syncToken(ctx: ReadContext, chatId: string): string {
  // An unreadable sync position only costs the missing messages, not the read.
  try {
    return String(ctx.acc.all("SELECT coalesce(_token,'') AS token FROM _squareToken WHERE _id=?", [chatId]).at(-1)?.token ?? '');
  } catch {
    return '';
  }
}

/**
 * An open chat's messages after the newest one this PC stores, from LINE's server: forward from
 * where LINE for PC's sync of the chat stopped, until LINE's last known activity, hiMs (0 = open)
 * or MAX_GAP_PAGES. It returns those in [loMs, hiMs], leaving out thread replies and messages this
 * PC has; complete is false when it stopped before the end.
 */
export async function readGap(
  ctx: ReadContext,
  server: OnlineServer,
  chatId: string,
  f: Freshness,
  loMs: number,
  hiMs: number,
): Promise<{ messages: SquareMessage[]; complete: boolean }> {
  let sync = syncToken(ctx, chatId);
  if (!sync) {
    server.report.cut.push(`${chatId}: LINE for PC has not recorded where its sync of this chat stopped`);
    return { messages: [], complete: false };
  }
  const stored = new Set(
    ctx.acc.all('SELECT _id FROM _message WHERE _chatId=? AND _createdTime>=?', [chatId, f.newestStored - STALE_SLACK_MS]).map((row) => String(row._id)),
  );
  if (!server.isDown()) server.notify(`reading chat ${chatId}'s messages after ${timeIso(f.newestStored)} from LINE's server (this PC does not store them)`);
  const out: SquareMessage[] = [];
  const seen = new Set<string>();
  let reached = 0;
  for (let page = 0; ; page++) {
    if (page === MAX_GAP_PAGES) {
      server.report.cut.push(`${chatId}: stopped after ${MAX_GAP_PAGES} calls at ${timeIso(reached)}`);
      return { messages: out, complete: false };
    }
    if (page > 0 && page % 10 === 0 && !server.isDown()) server.notify(`reading chat ${chatId} from LINE's server: at ${timeIso(reached)}`);
    let rep;
    try {
      rep = await server.call({ chatMid: chatId, syncToken: sync, limit: SQUARE_PAGE_SIZE });
    } catch (err) {
      // A SquareException is about this chat; anything else took the server down and its report says why.
      if (err instanceof SquareError) server.failed(chatId, err);
      return { messages: out, complete: false };
    }
    for (const m of rep.messages) {
      const created = createdOf(m);
      reached = Math.max(reached, created);
      if (seen.has(m.id) || stored.has(m.id) || (m.threadMid !== '' && !m.threadRoot)) continue;
      seen.add(m.id);
      if (created < loMs || (hiMs > 0 && created > hiMs)) continue;
      out.push(m);
      server.report.missing++;
    }
    reached = Math.max(reached, rep.lastEventAt);
    if (rep.events === 0 || rep.syncToken === '' || rep.syncToken === sync) return { messages: out, complete: true };
    if ((hiMs > 0 && reached > hiMs) || (f.lastActivity > 0 && reached >= f.lastActivity - LAST_EVENT_SLACK_MS)) {
      return { messages: out, complete: true };
    }
    sync = rep.syncToken;
  }
}
