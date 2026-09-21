/**
 * LINE PC message queries over a read-only database handle.
 *
 * This layer holds only SQL + row mapping and takes an injected `Queryable`, so its
 * logic is unit-tested offline against a node:sqlite fixture. The encrypted-DB driver
 * (better-sqlite3-multiple-ciphers) lives in cipherDb.ts and never loads here.
 */
import {
  buildContactsMap,
  buildNameMaps,
  contentTypeCode,
  escapeLike,
  matchSenderMids,
  ownMidsOf,
  parseMessageRow,
  resolveChat,
  saneLimit,
  SEARCHABLE_META_TYPES,
  tsToIso,
  type ChatType,
  type MessageRow,
  type NameMaps,
  type ParsedMessage,
} from './schema';

export interface Queryable {
  all(sql: string, params?: unknown[]): Record<string, unknown>[];
  get(sql: string, params?: unknown[]): Record<string, unknown> | undefined;
}

export interface ChatSummary {
  chat_id: string;
  name: string;
  type: ChatType;
  last_message_at: string | null;
}

export interface UnreadChat {
  chat_id: string;
  name: string;
  type: ChatType;
  unread_count: number;
  available_count: number;
  missing_count: number;
  fully_synced: boolean;
  messages: ParsedMessage[];
}

export interface ContactSummary {
  contact_id: string;
  display_name: string;
  /** Only present, as true, on an id the user holds themselves. */
  is_me?: boolean;
}

/** A search hit: the message plus where it was found, so the caller can drill into that chat. */
export interface MessageHit extends ParsedMessage {
  chat_id: string;
  chat_name: string;
  chat_type: ChatType;
}

export interface SearchOptions {
  /** Substring of the message text body (any length, CJK included). */
  query?: string;
  /** Already-resolved sender mids; resolve names with resolveSenders() first. */
  senderMids?: string[];
  chatId?: string;
  chatType?: string;
  /** A CONTENT_TYPE name such as 'file' or 'link'. */
  contentType?: string;
  /** Seconds, like getHistory. */
  sinceTs?: number;
  untilTs?: number;
  limit?: number;
  /** Drop official/bot accounts in SQL, so the limit is spent on real conversations. */
  excludeOfficial?: boolean;
  /**
   * 'desc' (default) answers "the newest N". 'asc' answers "the oldest N still unread", which
   * is what a watermark needs: a backlog larger than the limit is then drained in order
   * instead of jumping to its newest slice and stranding everything older.
   */
  order?: 'asc' | 'desc';
}

const T = {
  chat: '_chat',
  message: '_message',
  contact: '_contact',
  group: '_groupChat',
  room: '_room',
  square: '_squareChat',
  squareMember: '_squareMember',
  squareCommunity: '_square',
  profile: '_profile',
} as const;

/**
 * Keeps only the chats a human can recognise in a picker. resolveChat() falls back to the raw
 * chat id when no name table covers it, and on a real account that was 118 of 227 chats — 1:1
 * rooms with people who were never contacts, plus squares and rooms whose name rows are absent.
 * Listing those shows half the picker as hashes. They stay resolvable by id, just not offered.
 */
export function namedChats(chats: ChatSummary[]): ChatSummary[] {
  return chats.filter((chat) => chat.name !== chat.chat_id);
}

/**
 * Name and contact tables are rebuilt from full table scans, and a `line_read` step reading
 * five chats used to pay for five of each. They are cached per reader for this long — short
 * enough that a contact renamed in LINE shows up on the next run, long enough that one flow
 * step scans them once.
 */
const NAME_CACHE_TTL_MS = 60_000;

interface Cached<T> {
  at: number;
  value: T;
}

export class LineReader {
  private cachedMaps: Cached<NameMaps> | null = null;
  private cachedContacts: Cached<Map<string, string>> | null = null;
  private cachedOwnMids: Cached<Set<string>> | null = null;

  constructor(private readonly q: Queryable) {}

  // A synthetic or partial DB may lack a table; a missing table means "no rows", never a throw.
  private safeAll(sql: string, params?: unknown[]): Record<string, unknown>[] {
    try {
      return this.q.all(sql, params);
    } catch {
      return [];
    }
  }

  private safeGet(sql: string, params?: unknown[]): Record<string, unknown> | undefined {
    try {
      return this.q.get(sql, params);
    } catch {
      return undefined;
    }
  }

  private fresh<T>(cached: Cached<T> | null): T | null {
    return cached && Date.now() - cached.at < NAME_CACHE_TTL_MS ? cached.value : null;
  }

  private nameMaps(): NameMaps {
    const hit = this.fresh(this.cachedMaps);
    if (hit) return hit;
    const value = buildNameMaps({
      groups: this.safeAll(`SELECT _chatMid, _chatName FROM ${T.group}`) as never,
      squares: this.safeAll(`SELECT _squareChatMid, _name FROM ${T.square}`) as never,
      contacts: this.safeAll(`SELECT _mid, _displayName, _displayNameOverridden, _type FROM ${T.contact}`) as never,
      rooms: this.safeAll(`SELECT _mid FROM ${T.room}`) as never,
    });
    this.cachedMaps = { at: Date.now(), value };
    return value;
  }

  private contactsMap(): Map<string, string> {
    const hit = this.fresh(this.cachedContacts);
    if (hit) return hit;
    const value = buildContactsMap({
      contacts: this.safeAll(`SELECT _mid, _displayName, _displayNameOverridden FROM ${T.contact}`) as never,
      squareMembers: this.safeAll(`SELECT _squareMemberMid, _displayName FROM ${T.squareMember}`) as never,
      profile: this.safeAll(`SELECT _mid, _displayName FROM ${T.profile}`) as never,
    });
    this.cachedContacts = { at: Date.now(), value };
    return value;
  }

  // A DB without the profile tables yields an empty set: nothing gets marked, nothing throws.
  private ownMids(): Set<string> {
    const hit = this.fresh(this.cachedOwnMids);
    if (hit) return hit;
    const value = ownMidsOf({
      profile: this.safeAll(`SELECT _mid, _displayName FROM ${T.profile}`) as never,
      squares: this.safeAll(`SELECT _myMemberId FROM ${T.squareCommunity}`) as never,
    });
    this.cachedOwnMids = { at: Date.now(), value };
    return value;
  }

  listChats(opts?: { query?: string; chatType?: string; limit?: number }): ChatSummary[] {
    const limit = saneLimit(opts?.limit, 50);
    const query = (opts?.query ?? '').toLowerCase();
    const maps = this.nameMaps();
    const rows = this.safeAll(`SELECT _id, _lastUpdatedTime FROM ${T.chat} ORDER BY _lastUpdatedTime DESC`);
    const out: ChatSummary[] = [];
    for (const row of rows) {
      const chatId = String(row._id);
      const { name, type } = resolveChat(chatId, maps);
      if (opts?.chatType && type !== opts.chatType) continue;
      if (query && !name.toLowerCase().includes(query)) continue;
      out.push({ chat_id: chatId, name, type, last_message_at: tsToIso(row._lastUpdatedTime as number) });
      if (out.length >= limit) break;
    }
    return out;
  }

  getHistory(chatId: string, sinceTs: number, untilTs: number, limit = 500): ParsedMessage[] {
    const lim = saneLimit(limit, 500);
    const contactMap = this.contactsMap();
    const own = this.ownMids();
    // MCP passes bounds in seconds; _createdTime is milliseconds.
    const rows = this.safeAll(
      `SELECT * FROM ${T.message} WHERE _chatId=? AND _createdTime>=? AND _createdTime<=? ORDER BY _createdTime ASC LIMIT ?`,
      [chatId, sinceTs * 1000, untilTs * 1000, lim],
    );
    return rows.map((row) => parseMessageRow(row as MessageRow, contactMap, own));
  }

  // The "latest N" path: what you want when no time window is given. Most recent messages,
  // returned chronologically. Keeps the common case a one-argument call.
  getLatestHistory(chatId: string, limit = 200): ParsedMessage[] {
    const lim = saneLimit(limit, 200);
    const contactMap = this.contactsMap();
    const own = this.ownMids();
    const rows = this.safeAll(`SELECT * FROM ${T.message} WHERE _chatId=? ORDER BY _createdTime DESC LIMIT ?`, [chatId, lim]);
    rows.reverse();
    return rows.map((row) => parseMessageRow(row as MessageRow, contactMap, own));
  }

  /**
   * Maps a sender name (or a raw mid) to the mids to search. Empty means "nobody matched",
   * which callers must report rather than silently searching everyone.
   */
  resolveSenders(nameOrMid: string): string[] {
    return matchSenderMids(nameOrMid, this.contactsMap());
  }

  /**
   * Global message search: every chat at once, newest first, each hit tagged with the chat
   * it came from. `query` matches the text body and the attachment metadata of the types in
   * SEARCHABLE_META_TYPES, so a filename or a link title is findable too.
   *
   * A full scan is deliberate — a 168MB encrypted DB with 500k messages scans in well under
   * a second (adding the metadata column cost 81ms -> 107ms on the real DB) — and an FTS
   * index would be both an extra copy of private message text on disk and WRONG here: the
   * trigram tokenizer silently misses two-character CJK queries and the default tokenizer
   * treats a whole CJK run as one token.
   */
  searchMessages(opts: SearchOptions = {}): MessageHit[] {
    const limit = saneLimit(opts.limit, 50);
    const maps = this.nameMaps();
    const contactMap = this.contactsMap();
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.query) {
      const pattern = `%${escapeLike(opts.query)}%`;
      // Also match the metadata of the types that carry user content (filenames, link titles,
      // bot ALT_TEXT). Raw LIKE rather than json_extract on purpose: 47% of real
      // _contentMetadata values are not valid JSON and json_extract throws on those —
      // safeAll would swallow the throw and turn every search into "nothing found".
      where.push(
        `(_text LIKE ? ESCAPE '\\' OR (_contentType IN (${SEARCHABLE_META_TYPES.join(',')}) AND _contentMetadata LIKE ? ESCAPE '\\'))`,
      );
      params.push(pattern, pattern);
    }
    if (opts.contentType) {
      const code = contentTypeCode(opts.contentType);
      if (code === undefined) return [];
      where.push('_contentType=?');
      params.push(code);
    }
    if (opts.senderMids?.length) {
      where.push(`_from IN (${opts.senderMids.map(() => '?').join(',')})`);
      params.push(...opts.senderMids);
    }
    if (opts.chatId) {
      where.push('_chatId=?');
      params.push(opts.chatId);
    } else if (opts.chatType) {
      const ids = this.chatIdsOfType(opts.chatType, maps);
      if (ids.length === 0) return [];
      where.push(`_chatId IN (${ids.map(() => '?').join(',')})`);
      params.push(...ids);
    }
    // Bounds arrive in seconds; _createdTime is milliseconds (same contract as getHistory).
    if (opts.sinceTs !== undefined) {
      where.push('_createdTime>=?');
      params.push(opts.sinceTs * 1000);
    }
    if (opts.untilTs !== undefined) {
      where.push('_createdTime<=?');
      params.push(opts.untilTs * 1000);
    }
    if (opts.excludeOfficial && maps.official.size > 0) {
      const officials = [...maps.official];
      where.push(`_chatId NOT IN (${officials.map(() => '?').join(',')})`);
      params.push(...officials);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const direction = opts.order === 'asc' ? 'ASC' : 'DESC';
    const rows = this.safeAll(
      // SELECT * (like getHistory) rather than a column list: safeAll swallows SQL errors, so
      // naming columns would turn a LINE schema tweak into a silent zero-result search.
      `SELECT * FROM ${T.message} ${clause} ORDER BY _createdTime ${direction} LIMIT ?`,
      [...params, limit],
    );
    const own = this.ownMids();
    return rows.map((row) => {
      const chatId = String(row._chatId);
      const { name, type } = resolveChat(chatId, maps);
      return { chat_id: chatId, chat_name: name, chat_type: type, ...parseMessageRow(row as MessageRow, contactMap, own) };
    });
  }

  // Candidate chat ids for a type filter. Derived from _chat (actual chat rooms, hundreds at
  // most) rather than from the contact list, so the bound-parameter list stays far below
  // SQLite's limit even for a user with thousands of friends.
  private chatIdsOfType(chatType: string, maps: NameMaps): string[] {
    const rows = this.safeAll(`SELECT _id FROM ${T.chat}`);
    return rows.map((row) => String(row._id)).filter((id) => resolveChat(id, maps).type === chatType);
  }

  getUnread(opts?: { limitChats?: number; includeOfficial?: boolean; perChatLimit?: number }): UnreadChat[] {
    const limitChats = saneLimit(opts?.limitChats, 50);
    const perChatLimit = saneLimit(opts?.perChatLimit, 200);
    const maps = this.nameMaps();
    const contactMap = this.contactsMap();
    const official = opts?.includeOfficial ? new Set<string>() : maps.official;
    const rows = this.safeAll(
      `SELECT _id, _unreadCount, _lastUpdatedTime FROM ${T.chat} WHERE _unreadCount>0 ORDER BY _lastUpdatedTime DESC`,
    );
    const out: UnreadChat[] = [];
    for (const row of rows) {
      const chatId = String(row._id);
      if (official.has(chatId)) continue;
      const { name, type } = resolveChat(chatId, maps);
      const unread = Number(row._unreadCount) || 0;
      const { messages, available } = this.unreadMessages(chatId, unread, contactMap, perChatLimit);
      out.push({
        chat_id: chatId,
        name,
        type,
        unread_count: unread,
        available_count: available,
        missing_count: Math.max(0, unread - available),
        fully_synced: available >= unread,
        messages,
      });
      if (out.length >= limitChats) break;
    }
    return out;
  }

  // LINE gives no reliable per-message read boundary and _firstUnreadId is a stale
  // low-water mark, so available is capped by _unreadCount and the most recent
  // unread_count messages are treated as the unread ones. When fewer than unread_count
  // messages are on disk, the gap is surfaced honestly as missing_count.
  private unreadMessages(
    chatId: string,
    unreadCount: number,
    contactMap: Map<string, string>,
    limit: number,
  ): { messages: ParsedMessage[]; available: number } {
    if (unreadCount <= 0) return { messages: [], available: 0 };
    const presentTotal = Number(this.safeGet(`SELECT count(*) c FROM ${T.message} WHERE _chatId=?`, [chatId])?.c ?? 0);
    const available = Math.min(unreadCount, presentTotal);
    if (available === 0) return { messages: [], available: 0 };
    const rows = this.safeAll(`SELECT * FROM ${T.message} WHERE _chatId=? ORDER BY _createdTime DESC LIMIT ?`, [
      chatId,
      Math.min(unreadCount, limit),
    ]);
    rows.reverse();
    const own = this.ownMids();
    return { messages: rows.map((row) => parseMessageRow(row as MessageRow, contactMap, own)), available };
  }

  /**
   * A name fragment, or one exact mid. A mid also reaches open-chat members and the user's own
   * account, neither of which has a _contact row; the user's own ids come back marked is_me.
   */
  getContacts(query = ''): ContactSummary[] {
    const needle = query.trim();
    const contactMap = this.contactsMap();
    const own = this.ownMids();
    const summary = (mid: string, name: string): ContactSummary => ({
      contact_id: mid,
      display_name: name || mid,
      ...(own.has(mid) ? { is_me: true } : {}),
    });
    if (needle && contactMap.has(needle)) return [summary(needle, contactMap.get(needle) ?? '')];

    const lowered = needle.toLowerCase();
    const mine = this.safeAll(`SELECT _mid, _displayName FROM ${T.profile}`)
      .map((row) => summary(String(row._mid), (row._displayName as string | null) ?? ''))
      .filter((entry) => entry.display_name.toLowerCase().includes(lowered));
    const rows = needle
      ? this.safeAll(
          `SELECT _mid, _displayName, _displayNameOverridden FROM ${T.contact} WHERE _displayName LIKE ? OR _displayNameOverridden LIKE ?`,
          [`%${needle}%`, `%${needle}%`],
        )
      : this.safeAll(`SELECT _mid, _displayName, _displayNameOverridden FROM ${T.contact}`);
    const contacts = rows.map((row) => ({
      contact_id: String(row._mid),
      display_name: (row._displayNameOverridden as string) || (row._displayName as string) || String(row._mid),
    }));
    return [...mine, ...contacts];
  }
}
