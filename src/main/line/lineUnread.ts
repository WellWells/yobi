/**
 * Unread chats and their unread messages: LINE's own read boundary says where a chat's unread messages
 * start, and an open chat's unread messages LINE for PC has not synced are read from LINE's
 * server (lineOnline readGap). Read only: nothing is marked read.
 */
import type { ReaderAccess } from './reader';
import { MAX_LIMIT, resolveChat, saneLimit, type ChatType, type ParsedMessage } from './schema';
import { eventSql, plainKindSql, unsentSql, type HasColumn } from './lineSearchSql';
import { chatOptions, freshness, isBehind, isOpenChat, isStale, timeIso, type Freshness } from './lineFreshness';
import { plainSquare, readContext, readGap, squareToMessage, type ReadContext } from './lineOnline';
import type { OnlineServer } from './lineSquareServer';

export const DEFAULT_UNREAD_CHATS = 50;
export const DEFAULT_UNREAD_PER_CHAT = 200;

/**
 * Where a chat's unread messages start: LINE's first unread message (groups, 1:1), or after the
 * read marker (open chats, whose _firstUnreadId is not a message id, and chats whose first unread
 * message is not stored). A marker covering more than _unreadCount messages lags behind, so only
 * the newest _unreadCount after it are taken (unread_count).
 */
export type UnreadBoundary = 'first_unread' | 'read_marker' | 'unread_count' | 'not_stored' | 'none';

/** One unread chat, keys in line-cli's order. */
export interface LineUnreadChat {
  chat_id: string;
  name: string;
  type: ChatType;
  unread_count: number;
  available_count: number;
  missing_count: number;
  fully_synced: boolean;
  boundary: UnreadBoundary;
  stale: boolean;
  last_activity_at?: string;
  newest_stored_at?: string;
  muted: boolean;
  hidden?: boolean;
  messages: ParsedMessage[];
}

/** An unread chat with what its notes need. */
export interface UnreadEntry {
  chat: LineUnreadChat;
  /** More unread messages than per_chat_limit returned. */
  more: boolean;
  freshness: Freshness | null;
}

export interface UnreadOptions {
  limitChats?: number;
  includeOfficial?: boolean;
  includeHidden?: boolean;
  perChatLimit?: number;
  /** LINE is not running, so nothing counts as fully synced. */
  lineStopped?: boolean;
}

export async function readUnread(acc: ReaderAccess, opt: UnreadOptions, server: OnlineServer | null): Promise<UnreadEntry[]> {
  const maps = acc.nameMaps();
  const rows = acc.all('SELECT _id, _unreadCount FROM _chat WHERE _unreadCount>0 ORDER BY _lastUpdatedTime DESC');
  const options = chatOptions(acc.all);
  const ctx = readContext(acc);
  const limitChats = saneLimit(opt.limitChats, DEFAULT_UNREAD_CHATS);
  const perChat = saneLimit(opt.perChatLimit, DEFAULT_UNREAD_PER_CHAT);
  const out: UnreadEntry[] = [];
  for (const row of rows) {
    if (out.length >= limitChats) break;
    const id = String(row._id ?? '');
    const info = resolveChat(id, maps);
    if (info.type === 'official' && !opt.includeOfficial) continue;
    const o = options.get(id) ?? { hidden: false, muted: false };
    if (o.hidden && !opt.includeHidden) continue;
    const base = { id, name: info.name, type: info.type, unread: Number(row._unreadCount) || 0, muted: o.muted, hidden: o.hidden };
    out.push(await fillUnread(ctx, server, base, perChat, opt.lineStopped === true));
  }
  return out;
}

interface Boundary {
  boundary: UnreadBoundary;
  where: string;
  params: unknown[];
}

/** Picks the boundary and returns the matching _message filter. */
function unreadBoundary(acc: ReaderAccess, chatId: string): Boundary {
  const b: Boundary = { boundary: 'none', where: '_chatId=?', params: [chatId] };
  const row = acc.all(
    `SELECT coalesce(_firstUnreadId,'') AS fu, coalesce(_sendChatCheckedId,'') AS rc,
 (SELECT _createdTime FROM _message m WHERE m._id=c._firstUnreadId AND m._chatId=c._id) AS fut,
 (SELECT _createdTime FROM _message m WHERE m._id=c._sendChatCheckedId AND m._chatId=c._id) AS rct
 FROM _chat c WHERE c._id=?`,
    [chatId],
  )[0];
  if (!row) return b;
  // Not a message id in open chats.
  const firstUnread = isOpenChat(chatId) ? '' : String(row.fu ?? '');
  if (firstUnread !== '' && row.fut != null) {
    return { boundary: 'first_unread', where: `${b.where} AND _createdTime>=?`, params: [chatId, Number(row.fut)] };
  }
  if (row.rct != null) return { boundary: 'read_marker', where: `${b.where} AND _createdTime>?`, params: [chatId, Number(row.rct)] };
  if (firstUnread !== '' || String(row.rc ?? '') !== '') b.boundary = 'not_stored';
  return b;
}

interface ChatBase {
  id: string;
  name: string;
  type: ChatType;
  unread: number;
  muted: boolean;
  hidden: boolean;
}

/**
 * The boundary, counts and messages of one unread chat. Event and unsent rows, which LINE does not
 * count as unread, are returned but neither counted nor charged to perChat.
 */
async function fillUnread(ctx: ReadContext, server: OnlineServer | null, c: ChatBase, perChat: number, lineStopped: boolean): Promise<UnreadEntry> {
  const acc = ctx.acc;
  const f = freshness(acc.all, c.id);
  let stale = f ? isStale(f) : false;
  let { boundary, where, params } = unreadBoundary(acc, c.id);
  // Online, an open chat's messages after the newest stored one come from LINE's server; all are
  // newer than any stored message, so unread.
  const gap: ParsedMessage[] = [];
  const gapPlain: boolean[] = [];
  let gapCount = 0;
  if (server?.opt.enabled && f && isBehind(f) && boundary === 'read_marker') {
    const read = await readGap(ctx, server, c.id, f, 0, 0);
    for (const m of read.messages) {
      gap.push(squareToMessage(ctx, m, ''));
      gapPlain.push(plainSquare(m));
      if (plainSquare(m)) gapCount++;
    }
    if (read.complete) stale = false;
  }
  const cols = acc.columns('_message');
  const has: HasColumn = (column) => cols.has(column);
  let available = 0;
  let want = c.unread; // non-event messages to return
  if (boundary === 'not_stored') {
    want = 0;
  } else if (boundary === 'first_unread' || boundary === 'read_marker') {
    let n = (Number(acc.all(`SELECT count(*) AS n FROM _message WHERE ${where} AND ${plainKindSql(has)}`, params)[0]?.n) || 0) + gapCount;
    if (n > c.unread) {
      boundary = 'unread_count';
      n = c.unread;
    }
    available = n;
    want = n;
  }
  const missing = Math.max(0, c.unread - available);
  const exact = boundary === 'first_unread' || boundary === 'read_marker';
  const fullySynced = exact && missing === 0 && !stale && !lineStopped;
  const messages: ParsedMessage[] = [];
  const more = collectUnread(ctx, messages, gap, gapPlain, { where, params, want, quota: Math.min(want, perChat), whole: exact && Math.min(want, perChat) === want, has });
  messages.reverse();
  const lastActivity = f ? timeIso(f.lastActivity) : '';
  const newestStored = f ? timeIso(f.newestStored) : '';
  const chat: LineUnreadChat = {
    chat_id: c.id,
    name: c.name,
    type: c.type,
    unread_count: c.unread,
    available_count: available,
    missing_count: missing,
    fully_synced: fullySynced,
    boundary,
    stale,
    ...(lastActivity ? { last_activity_at: lastActivity } : {}),
    ...(newestStored ? { newest_stored_at: newestStored } : {}),
    muted: c.muted,
    ...(c.hidden ? { hidden: true } : {}),
    messages,
  };
  return { chat, more, freshness: f };
}

interface Quota {
  where: string;
  params: unknown[];
  want: number;
  quota: number;
  /** The whole range fits, events before the first unread one included. */
  whole: boolean;
  has: HasColumn;
}

/**
 * Takes the unread messages newest first into `out`: the ones from LINE's server, then the stored
 * rows. Returns whether more unread messages exist than were taken.
 */
function collectUnread(ctx: ReadContext, out: ParsedMessage[], gap: ParsedMessage[], gapPlain: boolean[], q: Quota): boolean {
  if (q.quota === 0 && !q.whole) return false;
  let taken = 0;
  for (let i = gap.length - 1; i >= 0; i--) {
    let stop = out.length >= MAX_LIMIT;
    if (gapPlain[i]) {
      stop = stop || taken === q.quota;
      if (!stop) taken++;
    } else {
      stop = stop || (taken === q.quota && !q.whole);
    }
    if (stop) return taken < q.want;
    out.push(gap[i]);
  }
  // Every row read is either taken or ends the loop, so this many rows always suffice.
  const lim = MAX_LIMIT - out.length + 1;
  const rows = ctx.acc.all(
    `SELECT *, (${eventSql(q.has)} OR ${unsentSql(q.has)}) AS yobi_event FROM _message WHERE ${q.where} ORDER BY _createdTime DESC LIMIT ?`,
    [...q.params, lim],
  );
  let rowsLeft = true;
  let next = 0;
  while (out.length < MAX_LIMIT) {
    if (next >= rows.length) {
      rowsLeft = false;
      break;
    }
    const row = rows[next++];
    if ((Number(row.yobi_event) || 0) === 0) {
      if (taken === q.quota) break;
      taken++;
    } else if (taken === q.quota && !q.whole) {
      break;
    }
    out.push(ctx.parse(row));
  }
  return rowsLeft && taken < q.want;
}
