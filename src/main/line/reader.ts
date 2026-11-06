/**
 * LINE PC message queries over a read-only database handle.
 *
 * This layer holds only SQL + row mapping and takes an injected `Queryable`. The
 * encrypted-DB driver (better-sqlite3-multiple-ciphers) lives in cipherDb.ts and never
 * loads here.
 */
import {
  buildContactsMap,
  buildNameMaps,
  contentTypeName,
  escapeLike,
  fileNameOf,
  MAX_LIMIT,
  ownMidsOf,
  parseMessageRow,
  resolveChat,
  saneLimit,
  tsToIso,
  type ChatType,
  type MessageRow,
  type NameMaps,
  type ParsedMessage,
} from './schema';
import {
  eventSql, MATCH_FN, plainKindSql, registerLineMatch, SEARCH_TYPE_NAMES, searchTerms, typeFilter, unsentSql, visibleSql, type HasColumn,
} from './lineSearchSql';
import { listContacts as listContactRows, type ContactList, type ContactSummary } from './lineContacts';
import { isChatIdPrefix, isPersonIn, pickChat, senderMids as resolveSenderMids, type Person, type SenderLookup } from './lineIdentity';
import { downloadedPath, localSearchDirs, probableLocalPath } from './lineLocalFile';
import { goField, goTrimSpace, metaNumber, metaString, parseEventInfo, parseMeta, storedName } from './lineMessageParts';
import { LineError } from './errors';
import type { MentionTarget } from './lineMention';
import { ownReaction } from './lineReactions';
import { markThreadRoot, THREAD_ROOTS_SQL, threadRootsOf, type ThreadRoot } from './lineThreadMark';

// A synthetic, partial, or older LINE DB may lack a table or column: that alone reads as "no rows".
const MISSING_SCHEMA = /no such (table|column)/i;
const LOCKED = /database is (locked|busy)|\bSQLITE_BUSY\b/i;

export interface Queryable {
  all(sql: string, params?: unknown[]): Record<string, unknown>[];
  get(sql: string, params?: unknown[]): Record<string, unknown> | undefined;
  /** Defines a deterministic scalar SQL function, used for folding text search (see lineSearchSql). */
  register(name: string, fn: (...args: unknown[]) => unknown): void;
}

export interface ChatSummary {
  chat_id: string;
  name: string;
  type: ChatType;
  /** Left out when the chat has no activity time. */
  last_message_at?: string;
  /** A thread's parent open chat. */
  parent_chat_id?: string;
  /** A group's member count, when its member list is stored. */
  member_count?: number;
  /** Only present, as true: a hidden chat, a muted chat (notifications off), a pinned chat. */
  hidden?: boolean;
  muted?: boolean;
  pinned?: boolean;
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

export type { ContactList, ContactSummary } from './lineContacts';

/** A member, keys in line-cli's field order; empty and false fields are left out. */
export interface Member {
  id: string;
  name: string;
  is_me?: boolean;
  /** group: creator; open chat: admin | co_admin | member. */
  role?: string;
  /** group: joined | invited; open chat: joined | left | kicked | banned | deleted | … */
  state?: string;
  invited?: boolean;
  joined_at?: string;
  /** The user's 1:1 chat with them, when one exists. */
  chat_id?: string;
  message_count: number;
  last_sent_at?: string;
}

export interface MemberList {
  chat: ChatSummary;
  members: Member[];
  total: number;
  /** Why the list may be incomplete (open-chat members who left; a fallback to message senders). */
  note?: string;
}

/** A stats group: only the grouping's own key is set; hour 0 is a real hour and is kept. */
export interface StatsGroup {
  sender_id?: string;
  sender?: string;
  from_me?: boolean;
  day?: string;
  hour?: number;
  type?: string;
  count: number;
  /** Always present; '' when the group's messages carry no time. */
  first_sent_at: string;
  last_sent_at: string;
}

export interface StatsResult {
  chat_id: string;
  chat_name: string;
  chat_type: ChatType;
  by: string;
  include_events: boolean;
  total: number;
  /** Left out when nothing was counted. */
  first_sent_at?: string;
  last_sent_at?: string;
  group_count: number;
  groups: StatsGroup[];
}

/** A file hit, keys in line-cli's field order; empty and false fields are left out (expired stays). */
export interface FileHit {
  chat_id: string;
  chat_name: string;
  chat_type: ChatType;
  sender: string;
  sender_id?: string;
  filename: string;
  file_size?: number;
  sent_at?: string;
  expires_at?: string;
  expired: boolean;
  e2ee?: boolean;
  from_me?: boolean;
  id: string;
  /** Where this PC saved the file, as LINE recorded it, when it still exists with the same size. */
  local_path?: string;
  /** A same-name, same-size guess in Downloads/Desktop/Documents/OneDrive*. */
  probable_local_path?: string;
}

export interface FindFileOptions {
  query?: string;
  ext?: string;
  /** A chat_id or name, resolved like line-cli's --chat. */
  chat?: string;
  /** A chat_id taken as-is (a flow's stored chat), used when `chat` is not given. */
  chatId?: string;
  chatType?: string;
  /** A `from` value (me, ids, a name), resolved like line-cli's --from. */
  from?: string;
  /** Already-resolved sender ids, used when `from` is not given; an empty list matches nothing. */
  senderMids?: string[];
  sinceTs?: number;
  untilTs?: number;
  limit?: number;
  order?: 'asc' | 'desc';
  /** Check the filesystem for the file's bytes; off for the no-local path and tests. */
  localSearch?: boolean;
}

/** The DB-derived part of the status, keys in its order; empty times are left out. */
export interface LineStatus {
  /** The span of messages stored on this PC, over the chats LINE lists (_chat rows). */
  newest_message_at?: string;
  oldest_message_at?: string;
  /** Visible, non-thread chats where LINE knows of newer activity than the newest stored message. */
  stale_chats: { count: number; chat_ids: string[] };
}

/** How far LINE's known last activity may lead the newest stored message before a chat is stale. */
const STALE_SLACK_MS = 60_000;
/** How many stale chat_ids status lists. */
const MAX_STALE_IDS = 5;


/** A search hit: the message plus where it was found, so the caller can drill into that chat. */
export interface MessageHit extends ParsedMessage {
  chat_id: string;
  chat_name: string;
  chat_type: ChatType;
}

export interface SearchOptions {
  /** Words that must all appear in what the message shows (any length, CJK included). */
  query?: string;
  /** A `from` value (me, ids, a name), resolved like line-cli's --from. */
  from?: string;
  /** Already-resolved sender ids, used when `from` is not given. */
  senderMids?: string[];
  /** A chat_id or name, resolved like line-cli's --chat. */
  chat?: string;
  /** A chat_id taken as-is (a flow's stored chat), used when `chat` is not given. */
  chatId?: string;
  chatType?: string;
  /** A search type name such as 'file', 'post', 'url' or 'type_N'. */
  contentType?: string;
  /** Seconds; 0 or absent = no bound. */
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
  buddyDetail: '_buddyDetail',
  group: '_groupChat',
  room: '_room',
  square: '_squareChat',
  squareMember: '_squareMember',
  squareCommunity: '_square',
  squareThread: '_squareThread',
  chatOption: '_chatOption',
  profile: '_profile',
  myKeyChain: '_myE2EEKeyChain',
  chatKeys: '_chatE2EEPublicKeys',
} as const;

/**
 * Keeps only the chats a human can recognise in a picker: resolveChat() falls back to the raw
 * chat id when no name table covers it. Unnamed chats stay resolvable by id, just not offered.
 */
export function namedChats(chats: ChatSummary[]): ChatSummary[] {
  return chats.filter((chat) => chat.name !== chat.chat_id);
}

const SQUARE_ROLES: Record<number, string> = { 1: 'admin', 2: 'co_admin', 10: 'member' };
const SQUARE_STATES: Record<number, string> = { 1: 'join_requested', 2: 'joined', 3: 'rejected', 4: 'left', 5: 'kicked', 6: 'banned', 7: 'deleted' };

function codeName(names: Record<number, string>, prefix: string, code: number): string {
  return names[code] ?? `${prefix}${code}`;
}

// A column as Go's ColumnText / ColumnInt64 read it: NULL is '' / 0, a fraction is truncated.
function colText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function colInt(value: unknown): number {
  return Math.trunc(Number(value)) || 0;
}

// Go orders strings by UTF-8 bytes (code points); JS `<` compares UTF-16 units, which disagrees
// once a character past U+FFFF meets one in U+E000-U+FFFF.
function goCompare(a: string, b: string): number {
  if (a === b) return 0;
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

const DOTTED_CAPITAL_I = String.fromCodePoint(0x130);
const CAPITAL_SIGMA = String.fromCodePoint(0x3a3);
const SMALL_SIGMA = String.fromCodePoint(0x3c3);

// Go's strings.ToLower maps each code point on its own: capital sigma is always the medial small
// sigma (JS picks the final form at a word's end), and the dotted capital I is a plain i.
function goToLower(value: string): string {
  return value.replaceAll(DOTTED_CAPITAL_I, 'i').replaceAll(CAPITAL_SIGMA, SMALL_SIGMA).toLowerCase();
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The sender name read shows: a name-table name, else the name LINE
// stored with the row, else the raw id.
function displaySender(contacts: Map<string, string>, mid: string, contentInfo: string, eventJson: string): string {
  const known = contacts.get(mid) || mid;
  if (known !== mid) return known;
  return storedName(mid, parseMeta(contentInfo), parseEventInfo(eventJson)) || mid;
}

// e2eeMark as line-cli reads it: a non-zero number, or a string other than '' and '0'.
function e2eeMarked(mark: unknown): boolean {
  if (typeof mark === 'number') return mark !== 0;
  if (typeof mark === 'string') return mark !== '' && mark !== '0';
  return false;
}

/** A member while the list is built: every member field plus `lastMs`, which only orders the list. */
interface MemberDraft {
  id: string;
  name: string;
  isMe: boolean;
  role: string;
  state: string;
  invited: boolean;
  joinedAt: string;
  chatId: string;
  messageCount: number;
  lastSentAt: string;
  lastMs: number;
}

// The JSON line-cli emits for a member: Go field order, omitempty fields left out, no lastMs.
function memberJson(d: MemberDraft): Member {
  return {
    id: d.id,
    name: d.name,
    ...(d.isMe ? { is_me: true } : {}),
    ...(d.role ? { role: d.role } : {}),
    ...(d.state ? { state: d.state } : {}),
    ...(d.invited ? { invited: true } : {}),
    ...(d.joinedAt ? { joined_at: d.joinedAt } : {}),
    ...(d.chatId ? { chat_id: d.chatId } : {}),
    message_count: d.messageCount,
    ...(d.lastSentAt ? { last_sent_at: d.lastSentAt } : {}),
  };
}

// Current members first, then admins, then the most active, then the latest to post.
function sortMembers(members: MemberDraft[]): void {
  const stateRank = (state: string): number => (state === '' || state === 'joined' ? 0 : state === 'invited' ? 1 : 2);
  const roleRank = (role: string): number => (role === 'admin' || role === 'creator' ? 0 : role === 'co_admin' ? 1 : 2);
  members.sort((a, b) => stateRank(a.state) - stateRank(b.state)
    || roleRank(a.role) - roleRank(b.role)
    || b.messageCount - a.messageCount
    || b.lastMs - a.lastMs
    || goCompare(a.name, b.name)
    || goCompare(a.id, b.id));
}

interface GroupExtra {
  members: [string, number][];
  invitees: string[];
  creator: string;
}

// A JSON object of numbers decoded into Go's map[string]float64: null is 0, any other type fails.
function floatMap(value: unknown): [string, number][] | null {
  if (value === undefined || value === null) return [];
  if (!isJsonObject(value)) return null;
  const out: [string, number][] = [];
  for (const [key, v] of Object.entries(value)) {
    if (v === null) out.push([key, 0]);
    else if (typeof v === 'number' && Number.isFinite(v)) out.push([key, v]);
    else return null;
  }
  return out;
}

// _groupChat._extra as Go's json.Unmarshal reads it: field names match case-insensitively,
// null is the zero value, and a field of the wrong type fails the whole decode (null = no list).
function groupExtraOf(raw: string): GroupExtra | null {
  let top: unknown;
  try {
    top = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  const none: GroupExtra = { members: [], invitees: [], creator: '' };
  if (top === null) return none;
  if (!isJsonObject(top)) return null;
  const group = goField(top, 'groupExtra');
  if (group === undefined || group === null) return none;
  if (!isJsonObject(group)) return null;
  const members = floatMap(goField(group, 'memberMids'));
  const invitees = floatMap(goField(group, 'inviteeMids'));
  const creator = goField(group, 'creator');
  if (!members || !invitees || (creator !== undefined && creator !== null && typeof creator !== 'string')) return null;
  return { members, invitees: invitees.map(([id]) => id), creator: typeof creator === 'string' ? creator : '' };
}

interface SenderStat {
  count: number;
  lastMs: number;
  fromName: string;
}

// When a chat has no stored member list, the people who sent messages stand in for it.
function addSenders(stats: Map<string, SenderStat>, add: (id: string, name: string) => MemberDraft): void {
  for (const id of stats.keys()) {
    if (id) add(id, '');
  }
}

// A stats --by type key: event for the system rows, unsent for taken-back ones, else the message type.
function statsTypeName(code: number): string {
  if (code === -1) return 'event';
  if (code === -2) return 'unsent';
  return contentTypeName(code);
}

// Senders and types most frequent first (ties by key), days and hours in time order.
function sortStatsGroups(groups: StatsGroup[], by: string): void {
  if (by === 'sender' || by === 'type') {
    groups.sort((a, b) => b.count - a.count || goCompare(`${a.sender_id ?? ''}${a.type ?? ''}`, `${b.sender_id ?? ''}${b.type ?? ''}`));
  } else if (by === 'day') {
    groups.sort((a, b) => goCompare(a.day ?? '', b.day ?? ''));
  } else if (by === 'hour') {
    groups.sort((a, b) => (a.hour ?? 0) - (b.hour ?? 0));
  }
}

export const DEFAULT_MEMBERS_LIMIT = 200;
export const DEFAULT_STATS_LIMIT = 100;
export const DEFAULT_FIND_FILE_LIMIT = 200;
export const STATS_GROUPINGS = ['sender', 'day', 'hour', 'type'] as const;

/**
 * Name and contact tables come from full table scans, so they are cached per reader: short enough
 * that a contact renamed in LINE shows up on the next run, long enough that one flow step scans once.
 */
const NAME_CACHE_TTL_MS = 60_000;

interface Cached<T> {
  at: number;
  value: T;
}

/** A chat plus the fields only name resolution and ordering need (not part of the public summary). */
interface ChatRow {
  summary: ChatSummary;
  /** A nicknamed contact's own name, for matching a chat by that name. */
  alt: string;
  /** Sort key: the later of the chat row's timestamp and its newest stored message. */
  activityMs: number;
}

/**
 * What the modules that extend the reader (online reads, unread) query through: the reader's own
 * missing-schema / lock handling, column lists and name tables.
 */
export interface ReaderAccess {
  all(sql: string, params?: unknown[]): Record<string, unknown>[];
  get(sql: string, params?: unknown[]): Record<string, unknown> | undefined;
  columns(table: string): Set<string>;
  nameMaps(): NameMaps;
  contacts(): Map<string, string>;
  ownMids(): Set<string>;
  threadRoots(): Map<string, ThreadRoot>;
  /** Parses stored _message rows as every read shows them, thread roots marked. */
  parser(): (row: Record<string, unknown>) => ParsedMessage;
}

export class LineReader {
  private cachedMaps: Cached<NameMaps> | null = null;
  private cachedContacts: Cached<Map<string, string>> | null = null;
  private cachedOwnMids: Cached<Set<string>> | null = null;
  private cachedRoots: Cached<Map<string, ThreadRoot>> | null = null;
  /** Column names per table, read once so SQL references only columns this DB has. */
  private tableCols = new Map<string, Set<string>>();
  private matchRegistered = false;

  /**
   * `onUnreadable` fires when the handle itself is broken (wrong key after LINE re-keyed, file
   * replaced, I/O error), so the owner can drop it and reopen on the next request.
   */
  constructor(
    private readonly q: Queryable,
    private readonly onUnreadable?: () => void,
  ) {}

  private safeAll(sql: string, params?: unknown[]): Record<string, unknown>[] {
    try {
      return this.q.all(sql, params);
    } catch (err) {
      return this.emptyOrThrow(err, []);
    }
  }

  private safeGet(sql: string, params?: unknown[]): Record<string, unknown> | undefined {
    try {
      return this.q.get(sql, params);
    } catch (err) {
      return this.emptyOrThrow(err, undefined);
    }
  }

  // Only a missing table/column is "no rows"; a broken handle answering "nothing" would be a lie.
  // The driver message stays out of the error: it can carry the DB path.
  private emptyOrThrow<T>(err: unknown, empty: T): T {
    const message = err instanceof Error ? err.message : String(err);
    if (MISSING_SCHEMA.test(message)) return empty;
    if (LOCKED.test(message)) throw new LineError('DB_LOCKED', 'The LINE database is locked.');
    this.onUnreadable?.();
    throw new LineError('DB_UNREADABLE', 'The LINE database could not be read; it will be reopened on the next request.');
  }

  private fresh<T>(cached: Cached<T> | null): T | null {
    return cached && Date.now() - cached.at < NAME_CACHE_TTL_MS ? cached.value : null;
  }

  // The columns a table actually has, so SQL degrades a missing column to NULL instead of failing
  // (an older LINE build, or a minimal fixture). A missing table yields an empty set.
  private tableColumns(table: string): Set<string> {
    const cached = this.tableCols.get(table);
    if (cached) return cached;
    const rows = this.safeAll(`SELECT name FROM pragma_table_info('${table}')`);
    const cols = new Set(rows.map((row) => String(row.name)));
    this.tableCols.set(table, cols);
    return cols;
  }

  private messageColumns(): Set<string> {
    return this.tableColumns(T.message);
  }

  private ensureMatchFn(): void {
    if (this.matchRegistered) return;
    registerLineMatch((name, fn) => this.q.register(name, fn));
    this.matchRegistered = true;
  }

  private nameMaps(): NameMaps {
    const hit = this.fresh(this.cachedMaps);
    if (hit) return hit;
    const value = buildNameMaps({
      groups: this.safeAll(`SELECT _chatMid, _chatName FROM ${T.group}`) as never,
      squares: this.safeAll(`SELECT _squareChatMid, _name FROM ${T.square}`) as never,
      contacts: this.safeAll(`SELECT _mid, _displayName, _displayNameOverridden, _type FROM ${T.contact} WHERE _mid<>''`) as never,
      // _type alone misses some official accounts; _capableBuddy=1 or a _buddyDetail row marks one too.
      officials: [
        ...this.safeAll(`SELECT _mid FROM ${T.contact} WHERE _capableBuddy=1`),
        ...this.safeAll(`SELECT _mid FROM ${T.buddyDetail}`),
      ].map((row) => String(row._mid)),
      rooms: this.safeAll(`SELECT _mid FROM ${T.room}`) as never,
      // Optional on older schemas / minimal fixtures: a missing table or column reads as [].
      threads: this.safeAll(`SELECT _threadMid, _chatMid FROM ${T.squareThread}`) as never,
      midTypes: this.safeAll(`SELECT _id, _midType FROM ${T.chat} WHERE _midType IS NOT NULL`) as never,
      profile: this.safeAll(`SELECT _mid, _displayName FROM ${T.profile}`) as never,
    });
    this.cachedMaps = { at: Date.now(), value };
    return value;
  }

  private contactsMap(): Map<string, string> {
    const hit = this.fresh(this.cachedContacts);
    if (hit) return hit;
    const value = buildContactsMap({
      contacts: this.safeAll(`SELECT _mid, _displayName, _displayNameOverridden FROM ${T.contact} WHERE _mid<>''`) as never,
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

  // Root message id -> the open-chat thread it starts; a DB without _squareThread has none.
  private threadRoots(): Map<string, ThreadRoot> {
    const hit = this.fresh(this.cachedRoots);
    if (hit) return hit;
    const value = threadRootsOf(this.safeAll(THREAD_ROOTS_SQL));
    this.cachedRoots = { at: Date.now(), value };
    return value;
  }

  // Stored rows as every read shows them: names, from_me, and
  // thread_id / thread_replies on a message that starts a thread.
  private rowParser(): (row: Record<string, unknown>) => ParsedMessage {
    const contactMap = this.contactsMap();
    const own = this.ownMids();
    const roots = this.threadRoots();
    return (row) => markThreadRoot(parseMessageRow(row as MessageRow, contactMap, own), roots);
  }

  access(): ReaderAccess {
    return {
      all: (sql, params) => this.safeAll(sql, params),
      get: (sql, params) => this.safeGet(sql, params),
      columns: (table) => this.tableColumns(table),
      nameMaps: () => this.nameMaps(),
      contacts: () => this.contactsMap(),
      ownMids: () => this.ownMids(),
      threadRoots: () => this.threadRoots(),
      parser: () => this.rowParser(),
    };
  }

  /**
   * Every chat, most recently active first. Activity is the later of `_chat._lastUpdatedTime` and
   * the newest stored message, so a chat with a stored message newer
   * than its row timestamp still sorts correctly. Carries member_count (groups), hidden/muted/pinned
   * (from _chatOption) and, for a nicknamed contact, their own name as `alt` for name resolution.
   */
  private loadChatRows(): ChatRow[] {
    const maps = this.nameMaps();
    // The same base order as line-cli, so chats of equal activity tie the same way.
    const rows = this.safeAll(`SELECT _id, _lastUpdatedTime FROM ${T.chat} ORDER BY _lastUpdatedTime DESC`);
    // Newest stored message per chat, in a separate query so a missing _message table (a partial
    // fixture or a chat with no stored history) leaves the chat listed, just without that activity.
    const lastMsg = new Map<string, number>();
    for (const m of this.safeAll(`SELECT _chatId, max(_createdTime) AS t FROM ${T.message} GROUP BY _chatId`)) {
      lastMsg.set(String(m._chatId), Number(m.t) || 0);
    }
    const memberCounts = new Map<string, number>();
    for (const g of this.safeAll(
      `SELECT _chatMid, CASE WHEN json_valid(_extra) THEN (SELECT count(*) FROM json_each(_extra,'$.groupExtra.memberMids')) END AS n FROM ${T.group}`,
    )) {
      const n = Number(g.n);
      if (Number.isFinite(n) && n > 0) memberCounts.set(String(g._chatMid), n);
    }
    const options = new Map<string, { hidden: boolean; muted: boolean; pinned: boolean }>();
    for (const o of this.safeAll(`SELECT _id, _hidden, _notification, _pinnedTime FROM ${T.chatOption}`)) {
      options.set(String(o._id), {
        hidden: Number(o._hidden) === 1,
        muted: o._notification != null && Number(o._notification) === 0,
        pinned: o._pinnedTime != null && Number(o._pinnedTime) > 0,
      });
    }
    const out: ChatRow[] = [];
    for (const row of rows) {
      const chatId = String(row._id);
      const info = resolveChat(chatId, maps);
      const activityMs = Math.max(Number(row._lastUpdatedTime) || 0, lastMsg.get(chatId) || 0);
      const summary: ChatSummary = { chat_id: chatId, name: info.name, type: info.type };
      const lastAt = tsToIso(activityMs);
      if (lastAt) summary.last_message_at = lastAt;
      if (info.parent) summary.parent_chat_id = info.parent;
      const mc = memberCounts.get(chatId);
      if (mc) summary.member_count = mc;
      const opt = options.get(chatId);
      if (opt?.hidden) summary.hidden = true;
      if (opt?.muted) summary.muted = true;
      if (opt?.pinned) summary.pinned = true;
      out.push({ summary, alt: info.alt ?? '', activityMs });
    }
    out.sort((a, b) => b.activityMs - a.activityMs);
    return out;
  }

  listChats(opts?: { query?: string; chatType?: string; limit?: number }): ChatSummary[] {
    const limit = saneLimit(opts?.limit, 50);
    const raw = opts?.query ?? '';
    const low = raw.trim().toLowerCase();
    // A chat_id matches exactly or, like a short git commit id, by a prefix of 4+ characters.
    const idPrefix = isChatIdPrefix(low);
    const out: ChatSummary[] = [];
    for (const { summary, alt } of this.loadChatRows()) {
      if (out.length >= limit) break;
      if (opts?.chatType && summary.type !== opts.chatType) continue;
      if (
        low && summary.chat_id !== raw && !(idPrefix && summary.chat_id.startsWith(low))
        && !summary.name.toLowerCase().includes(low) && !alt.toLowerCase().includes(low)
      ) continue;
      out.push(summary);
    }
    return out;
  }

  getHistory(chatId: string, sinceTs: number, untilTs: number, limit = 500): ParsedMessage[] {
    const lim = saneLimit(limit, 500);
    const parse = this.rowParser();
    // MCP passes bounds in seconds; _createdTime is milliseconds. +999 makes an inclusive `until`
    // cover the whole second, so a sent_at paged back as `until` returns its own message too.
    const rows = this.safeAll(
      `SELECT * FROM ${T.message} WHERE _chatId=? AND _createdTime>=? AND _createdTime<=? ORDER BY _createdTime ASC LIMIT ?`,
      [chatId, sinceTs * 1000, untilTs * 1000 + 999, lim],
    );
    return rows.map(parse);
  }

  // The "latest N" path: what you want when no time window is given. Most recent messages,
  // returned chronologically. Keeps the common case a one-argument call.
  getLatestHistory(chatId: string, limit = 200): ParsedMessage[] {
    const lim = saneLimit(limit, 200);
    const parse = this.rowParser();
    const rows = this.safeAll(`SELECT * FROM ${T.message} WHERE _chatId=? ORDER BY _createdTime DESC LIMIT ?`, [chatId, lim]);
    rows.reverse();
    return rows.map(parse);
  }

  /**
   * Finds one chat by exact chat_id, then by name (exact, case-insensitive, then substring);
   * `exactOnly` (send) stops after exact name. A name is the chat name or, for a contact given a
   * nickname, their own name too. Threads and the user's own chat count only when no other chat
   * matches (except exactOnly, where they compete). Several hits in the deciding tier, or any
   * substring hit on the full name of a person who has no 1:1 chat, throw CHAT_AMBIGUOUS with the
   * candidate chat_ids; no match throws CHAT_NOT_FOUND.
   */
  resolveChatInfo(arg: string, exactOnly = false): ChatSummary {
    return pickChat(arg, this.loadChatRows(), exactOnly, (needle) => isPersonIn(this.loadPeople(), needle)).summary;
  }

  /** resolveChatInfo returning just the chat_id. */
  resolveChatId(arg: string, exactOnly = false): string {
    return this.resolveChatInfo(arg, exactOnly).chat_id;
  }

  // People the user can be found among: themselves (_profile), contacts (own name and the nickname
  // the user set), and open-chat members. Each name they can be matched by is a separate entry.
  private loadPeople(): Person[] {
    const own = this.ownMids();
    const out: Person[] = [];
    for (const row of this.safeAll(`SELECT _mid, _displayName FROM ${T.profile}`)) {
      out.push({ id: String(row._mid), name: (row._displayName as string) ?? '', source: 'me' });
    }
    for (const row of this.safeAll(`SELECT _mid, _displayName, _displayNameOverridden FROM ${T.contact} WHERE _mid<>''`)) {
      const id = String(row._mid);
      const name = (row._displayName as string) ?? '';
      const nick = (row._displayNameOverridden as string) ?? '';
      out.push({ id, name, source: 'contact' });
      if (nick && nick !== name) out.push({ id, name: nick, source: 'contact' });
    }
    const communities = new Map<string, string>();
    for (const row of this.safeAll(`SELECT _mid, _name FROM ${T.squareCommunity}`)) {
      communities.set(String(row._mid), (row._name as string) ?? '');
    }
    for (const row of this.safeAll(`SELECT _squareMemberMid, _displayName, _squareMid FROM ${T.squareMember}`)) {
      const id = String(row._squareMemberMid);
      const sq = String(row._squareMid ?? '');
      out.push({ id, name: (row._displayName as string) ?? '', source: own.has(id) ? 'me' : 'open_chat_member', community: communities.get(sq) || sq });
    }
    return out;
  }

  /**
   * The messages around a message id, oldest first: about limit/2 before it, the message itself,
   * then the rest after. Same-millisecond rows are ordered by id. `chatArg`, when given, must be
   * the message's chat. Not combinable with a time range.
   */
  readAround(messageId: string, limit?: number, chatArg?: string): ParsedMessage[] {
    const { chatId, at } = this.messageAt(messageId);
    if (chatArg) {
      const want = this.resolveChatId(chatArg);
      if (want !== chatId) throw new LineError('INVALID_ARGUMENT', `message ${messageId} is in chat ${chatId}, not ${want}`);
    }
    const lim = saneLimit(limit, 20);
    const before = Math.floor(lim / 2);
    const parse = this.rowParser();
    const older = this.safeAll(
      `SELECT * FROM ${T.message} WHERE _chatId=? AND (_createdTime<? OR (_createdTime=? AND _id<?)) ORDER BY _createdTime DESC, _id DESC LIMIT ?`,
      [chatId, at, at, messageId, before],
    );
    const newer = this.safeAll(
      `SELECT * FROM ${T.message} WHERE _chatId=? AND (_createdTime>? OR (_createdTime=? AND _id>=?)) ORDER BY _createdTime ASC, _id ASC LIMIT ?`,
      [chatId, at, at, messageId, lim - before],
    );
    older.reverse();
    return [...older, ...newer].map(parse);
  }

  /** The chat a stored message belongs to; throws INVALID_ARGUMENT when the id is not on this PC. */
  messageChat(messageId: string): string {
    return this.messageAt(messageId).chatId;
  }

  private messageAt(messageId: string): { chatId: string; at: number } {
    const row = this.safeGet(`SELECT _chatId, _createdTime FROM ${T.message} WHERE _id=?`, [messageId]);
    if (!row) throw new LineError('INVALID_ARGUMENT', `no message with id ${messageId} in the local database`);
    return { chatId: String(row._chatId), at: Number(row._createdTime) || 0 };
  }

  // Each sender's message count, latest message time and stored fromName, events and unsent rows
  // excluded. _contentInfo is read only when the column exists.
  private chatSenders(chatId: string, has: HasColumn): Map<string, SenderStat> {
    const ci = has('_contentInfo') ? '_contentInfo' : "'' AS _contentInfo";
    const out = new Map<string, SenderStat>();
    for (const row of this.safeAll(
      `SELECT _from, count(*) AS c, max(_createdTime) AS t, ${ci} FROM ${T.message} WHERE _chatId=? AND ${plainKindSql(has)} GROUP BY _from`,
      [chatId],
    )) {
      out.set(colText(row._from), { count: colInt(row.c), lastMs: colInt(row.t), fromName: metaString(parseMeta(colText(row._contentInfo)), 'fromName') });
    }
    return out;
  }

  /**
   * Who is in a chat: a group's members and invitees, the members LINE has seen in an open chat's
   * (or thread's) community, or you and the other person in a 1:1. Falls back to the people who sent
   * messages when no member list is stored. Order: current members, admins, most messages, latest
   * to post. Each member is line-cli's member JSON.
   */
  members(chatArg: string, limit?: number): MemberList {
    const chat = this.resolveChatInfo(chatArg);
    const contactMap = this.contactsMap();
    const own = this.ownMids();
    const maps = this.nameMaps();
    const has: HasColumn = (c) => this.messageColumns().has(c);
    const stats = this.chatSenders(chat.chat_id, has);
    const hasChat = new Set(this.loadChatRows().map((row) => row.summary.chat_id));
    const out: MemberDraft[] = [];
    const add = (id: string, name: string): MemberDraft => {
      const stat = stats.get(id);
      const lastMs = stat?.lastMs ?? 0;
      const member: MemberDraft = {
        id, name, isMe: own.has(id), role: '', state: '', invited: false, joinedAt: '', chatId: '',
        messageCount: stat?.count ?? 0, lastSentAt: tsToIso(lastMs), lastMs,
      };
      if (!member.name) member.name = contactMap.get(id) || id;
      if (member.name === id && stat?.fromName) member.name = stat.fromName;
      if (hasChat.has(id)) member.chatId = id;
      out.push(member);
      return member;
    };
    let note: string | undefined;
    switch (chat.type) {
      case 'group':
        if (!this.groupMembers(chat.chat_id, add)) {
          note = 'no member list is stored for this group; listing the people who sent messages in it';
          addSenders(stats, add);
        }
        break;
      case 'open':
      case 'thread':
        if (this.squareMembers(chat.chat_id, chat.type, add)) {
          note = 'open-chat members are the users LINE has seen in this community, including people who left (see state); not a complete member list';
        } else {
          note = 'no member list is stored for this open chat; listing the people who sent messages in it';
          addSenders(stats, add);
        }
        break;
      case 'personal':
      case 'official':
      case 'self':
        if (maps.self) add(maps.self, maps.selfName);
        if (chat.type !== 'self') add(chat.chat_id, '');
        break;
      default:
        note = 'no member list is stored for this chat; listing the people who sent messages in it';
        addSenders(stats, add);
    }
    sortMembers(out);
    const total = out.length;
    return { chat, members: out.slice(0, saneLimit(limit, DEFAULT_MEMBERS_LIMIT)).map(memberJson), total, ...(note ? { note } : {}) };
  }

  private groupMembers(chatId: string, add: (id: string, name: string) => MemberDraft): boolean {
    // Like line-cli's scan, the last matching row wins.
    const rows = this.safeAll(`SELECT _extra FROM ${T.group} WHERE _chatMid=?`, [chatId]);
    if (rows.length === 0) return false;
    const group = groupExtraOf(colText(rows[rows.length - 1]._extra));
    if (!group || group.members.length === 0) return false;
    const memberIds = new Set<string>();
    for (const [id, ts] of group.members) {
      memberIds.add(id);
      const member = add(id, '');
      member.state = 'joined';
      member.joinedAt = tsToIso(Math.trunc(ts));
      if (id === group.creator) member.role = 'creator';
    }
    for (const id of group.invitees) {
      if (memberIds.has(id)) continue;
      const member = add(id, '');
      member.state = 'invited';
      member.invited = true;
    }
    return true;
  }

  private squareMembers(chatId: string, type: ChatType, add: (id: string, name: string) => MemberDraft): boolean {
    const sqRows = this.safeAll(
      type === 'thread' ? `SELECT _squareMid FROM ${T.squareThread} WHERE _threadMid=?` : `SELECT _squareMid FROM ${T.square} WHERE _squareChatMid=?`,
      [chatId],
    );
    const square = sqRows.length > 0 ? colText(sqRows[sqRows.length - 1]._squareMid) : '';
    if (!square) return false;
    let found = false;
    for (const row of this.safeAll(`SELECT _squareMemberMid, _displayName, _role, _membershipState FROM ${T.squareMember} WHERE _squareMid=?`, [square])) {
      found = true;
      const member = add(colText(row._squareMemberMid), colText(row._displayName));
      member.role = codeName(SQUARE_ROLES, 'role_', colInt(row._role));
      member.state = codeName(SQUARE_STATES, 'state_', colInt(row._membershipState));
    }
    return found;
  }

  /**
   * Counts a chat's messages with one GROUP BY: `--by sender` (default), `day`, `hour` (0-23 over
   * the whole range) or `type`. System events and unsent messages are left out unless include_events.
   */
  stats(chatArg: string, opts: { by?: string; sinceTs?: number; untilTs?: number; limit?: number; includeEvents?: boolean } = {}): StatsResult {
    // Only an absent `by` defaults; an explicit '' is as invalid as line-cli's `--by ''`.
    const by = opts.by ?? 'sender';
    if (!(STATS_GROUPINGS as readonly string[]).includes(by)) {
      throw new LineError('INVALID_ARGUMENT', `invalid by: ${by} (valid: ${STATS_GROUPINGS.join(', ')})`);
    }
    const has: HasColumn = (c) => this.messageColumns().has(c);
    const keyExpr: Record<(typeof STATS_GROUPINGS)[number], string> = {
      sender: '_from',
      day: `strftime('%Y-%m-%d', _createdTime/1000, 'unixepoch', 'localtime')`,
      hour: `CAST(strftime('%H', _createdTime/1000, 'unixepoch', 'localtime') AS INTEGER)`,
      type: `CASE WHEN ${unsentSql(has)} THEN -2 WHEN ${eventSql(has)} THEN -1 ELSE _contentType END`,
    };
    const key = keyExpr[by as (typeof STATS_GROUPINGS)[number]];
    const chat = this.resolveChatInfo(chatArg);
    const where = ['_chatId=?'];
    const params: unknown[] = [chat.chat_id];
    if (opts.sinceTs) {
      where.push('_createdTime>=?');
      params.push(opts.sinceTs * 1000);
    }
    if (opts.untilTs) {
      where.push('_createdTime<=?');
      params.push(opts.untilTs * 1000 + 999);
    }
    if (!opts.includeEvents) where.push(plainKindSql(has));
    const clause = where.join(' AND ');
    const rows = this.safeAll(`SELECT ${key} AS k, count(*) AS c, min(_createdTime) AS mn, max(_createdTime) AS mx FROM ${T.message} WHERE ${clause} GROUP BY k`, params);
    const contactMap = this.contactsMap();
    const own = this.ownMids();
    const groups: StatsGroup[] = [];
    let total = 0;
    let first = 0;
    let last = 0;
    for (const row of rows) {
      const count = colInt(row.c);
      const mn = colInt(row.mn);
      const mx = colInt(row.mx);
      groups.push({ ...this.statsKey(by, row.k, contactMap, own), count, first_sent_at: tsToIso(mn), last_sent_at: tsToIso(mx) });
      total += count;
      // A group without times (0) resets `first` until a later group sets it.
      if (first === 0 || mn < first) first = mn;
      last = Math.max(last, mx);
    }
    const groupCount = groups.length;
    if (by === 'sender') this.statsSenderNames(groups, clause, params, has, contactMap);
    sortStatsGroups(groups, by);
    const limit = saneLimit(opts.limit, DEFAULT_STATS_LIMIT);
    let shown = groups;
    if (by !== 'hour' && groups.length > limit) shown = by === 'day' ? groups.slice(groups.length - limit) : groups.slice(0, limit);
    const firstAt = tsToIso(first);
    const lastAt = tsToIso(last);
    return {
      chat_id: chat.chat_id,
      chat_name: chat.name,
      chat_type: chat.type,
      by,
      include_events: opts.includeEvents ?? false,
      total,
      ...(firstAt ? { first_sent_at: firstAt } : {}),
      ...(lastAt ? { last_sent_at: lastAt } : {}),
      group_count: groupCount,
      groups: shown,
    };
  }

  // A stats group's key fields in line-cli's order. A sender is named from the name tables, or
  // "(system)" when the row has no _from; an empty day is left out, hour 0 is kept.
  private statsKey(by: string, key: unknown, contacts: Map<string, string>, own: Set<string>): Partial<StatsGroup> {
    if (by === 'sender') {
      const id = colText(key);
      return {
        ...(id ? { sender_id: id } : {}),
        sender: contacts.get(id) || id || '(system)',
        ...(id && own.has(id) ? { from_me: true } : {}),
      };
    }
    if (by === 'day') {
      const day = colText(key);
      return day ? { day } : {};
    }
    if (by === 'hour') return { hour: colInt(key) };
    const type = statsTypeName(colInt(key));
    return type ? { type } : {};
  }

  // Names the senders no name table knows the way read does: with
  // the name LINE stored on their latest counted message, from _contentInfo or _eventInfo (a
  // single max() aggregate, so the bare columns are that row's).
  private statsSenderNames(groups: StatsGroup[], clause: string, params: unknown[], has: HasColumn, contacts: Map<string, string>): void {
    const unknown = new Map<string, StatsGroup>();
    for (const group of groups) {
      if (group.sender_id && group.sender === group.sender_id) unknown.set(group.sender_id, group);
    }
    if (unknown.size === 0 || (!has('_contentInfo') && !has('_eventInfo'))) return;
    const ci = has('_contentInfo') ? '_contentInfo' : "'' AS _contentInfo";
    const ev = has('_eventInfo') ? '_eventInfo' : "'' AS _eventInfo";
    const ids = [...unknown.keys()];
    for (const row of this.safeAll(
      `SELECT _from, max(_createdTime), ${ci}, ${ev} FROM ${T.message} WHERE ${clause} AND _from IN (${ids.map(() => '?').join(',')}) GROUP BY _from`,
      [...params, ...ids],
    )) {
      const id = colText(row._from);
      const group = unknown.get(id);
      if (group) group.sender = displaySender(contacts, id, colText(row._contentInfo), colText(row._eventInfo));
    }
  }

  /**
   * Files shared in chats, by file name, newest first (order 'asc' for oldest first). Mirrors
   * line-cli's find-file: filters by chat / chat type / sender / time / extension,
   * with a LIKE prefilter on the query and extension; reports expiry and, when localSearch is on,
   * where this PC has the file. `_contentType=14`. Each hit is line-cli's file hit JSON.
   */
  findFile(opts: FindFileOptions = {}): FileHit[] {
    const maps = this.nameMaps();
    const contactMap = this.contactsMap();
    const own = this.ownMids();
    const has: HasColumn = (c) => this.messageColumns().has(c);
    const where = ['_contentType=?'];
    const params: unknown[] = [14];
    // Resolved in line-cli's order: chat, then chat type (no such chat = nothing, before any sender
    // check), then sender.
    const chatId = opts.chat ? this.resolveChatId(opts.chat) : opts.chatId;
    if (chatId) {
      where.push('_chatId=?');
      params.push(chatId);
    } else if (opts.chatType) {
      const ids = this.chatIdsOfType(opts.chatType, maps);
      if (ids.length === 0) return [];
      where.push(`_chatId IN (${ids.map(() => '?').join(',')})`);
      params.push(...ids);
    }
    const senders = opts.from ? this.resolveSenders(opts.from) : opts.senderMids;
    if (senders) {
      // An empty list (no own ids for "me") matches nothing, like `_from IN ()`.
      where.push(senders.length > 0 ? `_from IN (${senders.map(() => '?').join(',')})` : '0');
      params.push(...senders);
    }
    if (opts.sinceTs) {
      where.push('_createdTime>=?');
      params.push(opts.sinceTs * 1000);
    }
    if (opts.untilTs) {
      where.push('_createdTime<=?');
      params.push(opts.untilTs * 1000 + 999);
    }
    // A cheap prefilter on the raw columns; the file-name check below decides. A term with a quote
    // or backslash is escaped inside the stored JSON, so it is left to that check.
    const col = (name: string): string => (has(name) ? name : 'NULL');
    for (const term of [goTrimSpace(opts.query ?? ''), goTrimSpace(opts.ext ?? '').replace(/^\./, '')]) {
      if (!term || /["\\]/.test(term)) continue;
      const pattern = `%${escapeLike(term)}%`;
      where.push(`(${col('_contentInfo')} LIKE ? ESCAPE '\\' OR ${col('_contentMetadata')} LIKE ? ESCAPE '\\' OR ${col('_text')} LIKE ? ESCAPE '\\')`);
      params.push(pattern, pattern, pattern);
    }
    const limit = saneLimit(opts.limit, DEFAULT_FIND_FILE_LIMIT);
    const order = opts.order === 'asc' ? 'ASC' : 'DESC';
    const rows = this.safeAll(`SELECT * FROM ${T.message} WHERE ${where.join(' AND ')} ORDER BY _createdTime ${order}`, params);
    const query = goToLower(goTrimSpace(opts.query ?? ''));
    // line-cli trims the extension for the prefilter only, not here.
    const ext = goToLower((opts.ext ?? '').replace(/^\./, ''));
    const nowMs = Date.now();
    // Listed once per call rather than per file.
    let searchDirs: string[] | undefined;
    const out: FileHit[] = [];
    for (const row of rows) {
      if (out.length >= limit) break;
      const contentInfo = colText(row._contentInfo);
      const metadata = colText(row._contentMetadata);
      const name = fileNameOf(contentInfo, metadata, colText(row._text));
      if (!name) continue;
      const lname = goToLower(name);
      if (query && !lname.includes(query)) continue;
      if (ext && !lname.endsWith(`.${ext}`)) continue;
      const meta = parseMeta(metadata);
      const from = colText(row._from);
      const rowChat = colText(row._chatId);
      const info = resolveChat(rowChat, maps);
      const fileSize = metaNumber(meta, 'FILE_SIZE');
      const sentAt = tsToIso(colInt(row._createdTime));
      const expires = metaNumber(meta, 'FILE_EXPIRE_TIMESTAMP');
      // A zero expiry formats to '' and is left out, yet still counts as expired.
      const expiresAt = expires === null ? '' : tsToIso(expires);
      let localPath = '';
      let probablePath = '';
      if (opts.localSearch) {
        const ci = parseMeta(contentInfo);
        localPath = downloadedPath(metaString(ci, 'downloadedPath'), metaNumber(ci, 'downloadedFileSize'), fileSize) ?? '';
        if (!localPath && fileSize !== null) probablePath = probableLocalPath(name, fileSize, (searchDirs ??= localSearchDirs())) ?? '';
      }
      out.push({
        chat_id: rowChat,
        chat_name: info.name,
        chat_type: info.type,
        sender: displaySender(contactMap, from, contentInfo, ''),
        ...(from ? { sender_id: from } : {}),
        filename: name,
        ...(fileSize !== null ? { file_size: fileSize } : {}),
        ...(sentAt ? { sent_at: sentAt } : {}),
        ...(expiresAt ? { expires_at: expiresAt } : {}),
        expired: expires !== null && nowMs > expires,
        ...(e2eeMarked(meta.e2eeMark) ? { e2ee: true } : {}),
        ...(from && own.has(from) ? { from_me: true } : {}),
        id: colText(row._id),
        ...(localPath ? { local_path: localPath } : {}),
        ...(probablePath ? { probable_local_path: probablePath } : {}),
      });
    }
    return out;
  }

  /**
   * How fresh the local data is (DB-derived): the span of stored messages
   * and the visible, non-thread chats LINE knows have newer activity than this PC has stored (open
   * them in LINE to sync). The "LINE is running" check belongs to the service, not this SQL layer.
   */
  status(): LineStatus {
    // Over every chat: LINE's last activity (_lastUpdatedTime or
    // _lastMessage.createdTime), whether _lastMessage.id is missing locally, and the stored span.
    // Only chats with a _chat row count, newest activity first.
    const lastMessage = this.tableColumns(T.chat).has('_lastMessage') ? '_lastMessage' : 'NULL';
    const lastMissing = this.messageColumns().has('_id')
      ? `lid<>'' AND NOT EXISTS(SELECT 1 FROM ${T.message} m WHERE m._id=x.lid)`
      : '0';
    const rows = this.safeAll(
      `SELECT _id, max(coalesce(_lastUpdatedTime,0), lct) AS activity, ${lastMissing} AS missing,
        coalesce((SELECT max(_createdTime) FROM ${T.message} m WHERE m._chatId=x._id),0) AS newest,
        coalesce((SELECT min(_createdTime) FROM ${T.message} m WHERE m._chatId=x._id),0) AS oldest
      FROM (SELECT _id, _lastUpdatedTime,
        CASE WHEN json_valid(${lastMessage}) THEN coalesce(json_extract(${lastMessage},'$.id'),'') ELSE '' END AS lid,
        CASE WHEN json_valid(${lastMessage}) THEN coalesce(json_extract(${lastMessage},'$.createdTime'),0) ELSE 0 END AS lct
        FROM ${T.chat}) x
      ORDER BY 2 DESC`,
    );
    // _hidden=1 hides a chat from LINE's list; like a map, a chat's last option row wins.
    const hidden = new Map<string, boolean>();
    for (const row of this.safeAll(`SELECT _id, _hidden FROM ${T.chatOption}`)) hidden.set(colText(row._id), colInt(row._hidden) === 1);
    let newest = 0;
    let oldest = 0;
    let staleCount = 0;
    const staleIds: string[] = [];
    for (const row of rows) {
      const chatId = colText(row._id);
      const newestStored = colInt(row.newest);
      const oldestStored = colInt(row.oldest);
      newest = Math.max(newest, newestStored);
      if (oldestStored !== 0 && (oldest === 0 || oldestStored < oldest)) oldest = oldestStored;
      const stale = colInt(row.missing) !== 0 || colInt(row.activity) > newestStored + STALE_SLACK_MS;
      // Thread chats (t…) keep their replies on the server and hidden chats are often cleared, so
      // neither says anything about sync health.
      if (!stale || hidden.get(chatId) || chatId.startsWith('t')) continue;
      staleCount++;
      if (staleIds.length < MAX_STALE_IDS) staleIds.push(chatId);
    }
    const newestAt = tsToIso(newest);
    const oldestAt = tsToIso(oldest);
    return {
      ...(newestAt ? { newest_message_at: newestAt } : {}),
      ...(oldestAt ? { oldest_message_at: oldestAt } : {}),
      stale_chats: { count: staleCount, chat_ids: staleIds },
    };
  }

  /** The user's own account mid (the one _profile row). Throws when there is no profile row. */
  myMid(): string {
    const row = this.safeGet(`SELECT _mid FROM ${T.profile} LIMIT 1`);
    const mid = row ? String(row._mid ?? '') : '';
    if (!mid) throw new LineError('DB_UNREADABLE', 'own account id not found');
    return mid;
  }

  /** A mid's display name from the name tables, or the mid itself when unknown. */
  displayNameOf(mid: string): string {
    const name = this.contactsMap().get(mid);
    return name && name !== mid ? name : mid;
  }

  /** A warning when the recipient is not a friend in contacts, so a send can flag it; '' otherwise. */
  contactWarning(chatId: string): string {
    const row = this.safeGet(`SELECT _status FROM ${T.contact} WHERE _mid=?`, [chatId]);
    if (!row) return `recipient ${chatId} is not in your contacts; make sure this is the intended person`;
    const status = Number(row._status);
    if (status !== 1) return `recipient ${chatId} is in your contacts but not as a friend (status ${status}); make sure this is the intended person`;
    return '';
  }

  /** The ids the user sends under (for marking from_me and matching a sent message on verify). */
  ownIds(): ReadonlySet<string> {
    return this.ownMids();
  }

  /**
   * The stored key columns a send needs, as they are: the native core reads their format and picks
   * the keys. `found` is false when LINE stored no row for the chat.
   */
  sendKeyRows(chatId: string): { found: boolean; enabled: boolean; publicKeys: string; keychain: string } {
    const row = this.safeGet(`SELECT _publicKeys, _e2eeEnabled FROM ${T.chatKeys} WHERE _chatId=?`, [chatId]);
    const chain = this.safeGet(`SELECT _e2eeKeyChain FROM ${T.myKeyChain}`);
    return {
      found: row !== undefined,
      enabled: row === undefined || Number(row._e2eeEnabled) !== 0,
      publicKeys: colText(row?._publicKeys),
      keychain: colText(chain?._e2eeKeyChain),
    };
  }

  /**
   * The group's members LINE stores on this PC, by id, as people to tag; null when it stores no
   * list. An invitee is left out: LINE does not tag someone who has not joined.
   */
  joinedMembers(chatId: string): Map<string, MentionTarget> | null {
    const contacts = this.contactsMap();
    const { ownName } = this.nameMaps();
    const drafts: MemberDraft[] = [];
    const found = this.groupMembers(chatId, (id, name) => {
      const draft: MemberDraft = { id, name, isMe: false, role: '', state: '', invited: false, joinedAt: '', chatId: '', messageCount: 0, lastSentAt: '', lastMs: 0 };
      drafts.push(draft);
      return draft;
    });
    if (!found) return null;
    const out = new Map<string, MentionTarget>();
    for (const { id, state } of drafts) {
      if (state !== 'joined') continue;
      const name = contacts.get(id);
      const own = ownName.get(id);
      out.set(id, { id, name: name || id, labels: [...(name ? [name] : []), ...(own ? [own] : [])] });
    }
    return out;
  }

  /**
   * My reaction on a stored message as its predefined code, 0 for none; undefined when the row
   * cannot be read. The list is the newer record: when it mentions me, a leftover legacy entry does
   * not count.
   */
  ownReactionCode(messageId: string, own: ReadonlySet<string>): number | undefined {
    const cols = ['_reactionStatus', '_reactions'].filter((c) => this.messageColumns().has(c));
    if (cols.length === 0) return undefined;
    const row = this.safeGet(`SELECT ${cols.join(', ')} FROM ${T.message} WHERE _id=?`, [messageId]);
    return row ? ownReaction(colText(row._reactionStatus), colText(row._reactions), own) : undefined;
  }

  /** Whether the stored message shows as taken back. */
  isUnsent(messageId: string): boolean {
    return Number(this.safeGet(`SELECT _attribute FROM ${T.message} WHERE _id=?`, [messageId])?._attribute ?? 0) === 1;
  }

  /** One stored message parsed as read shows it (sender named from the name tables), or undefined. */
  storedMessage(messageId: string): ParsedMessage | undefined {
    const row = this.safeGet(`SELECT * FROM ${T.message} WHERE _id=?`, [messageId]);
    return row ? parseMessageRow(row as MessageRow, this.contactsMap(), this.ownMids()) : undefined;
  }

  /**
   * Ids of messages in a chat since `sinceMs` that one of `ownIds` sent and that match the sent
   * message: its server id, or when that is unknown a file's object id (`oid`, the metadata's OID),
   * or else its exact text; for a reply (`relatedId`), also linked to the replied message. Used to
   * verify a send.
   */
  findSentMessageIds(chatId: string, sinceMs: number, ownIds: ReadonlySet<string>, serverID: string, text: string, relatedId = '', oid = ''): Set<string> {
    const out = new Set<string>();
    const cols = ['_id', '_from', '_text', ...(relatedId ? ['_relatedMessageId'] : []), ...(oid ? ['_contentMetadata'] : [])].join(', ');
    for (const row of this.safeAll(`SELECT ${cols} FROM ${T.message} WHERE _chatId=? AND _createdTime>=?`, [chatId, sinceMs])) {
      const from = String(row._from ?? '');
      if (!ownIds.has(from)) continue;
      if (relatedId && String(row._relatedMessageId ?? '') !== relatedId) continue;
      const id = String(row._id ?? '');
      const hit = serverID
        ? id === serverID
        : oid
          ? metaString(parseMeta(row._contentMetadata as string | null | undefined), 'OID') === oid
          : String(row._text ?? '') === text;
      if (hit) out.add(id);
    }
    return out;
  }

  /**
   * The FILE_EXPIRE_TIMESTAMP (ms) LINE's server gave the file message with object id `oid`, as
   * LINE stored it, or 0.
   */
  storedFileExpire(chatId: string, oid: string): number {
    for (const row of this.safeAll(`SELECT COALESCE(_contentMetadata, '') AS m FROM ${T.message} WHERE _chatId=? AND _contentMetadata LIKE ?`, [chatId, `%${oid}%`])) {
      const meta = parseMeta(row.m as string);
      if (metaString(meta, 'OID') !== oid) continue;
      const raw = metaString(meta, 'FILE_EXPIRE_TIMESTAMP');
      if (/^[+-]?\d+$/.test(raw)) return Number(raw);
    }
    return 0;
  }

  /** LINE PC's stored copy of LINE's server settings (`_setting` key 'setting'), or '' when absent. */
  serverSettings(): string {
    const row = this.safeGet(`SELECT CAST(_value AS TEXT) AS v FROM _setting WHERE _key = 'setting'`);
    return typeof row?.v === 'string' ? row.v : '';
  }

  /**
   * The sender ids a `from` value means: "me" is every id the user posts
   * under, ids (comma-separated) are taken as-is, a name goes through exact, case-insensitive,
   * then substring; several people in the deciding tier throw SENDER_AMBIGUOUS with candidates.
   */
  resolveSenders(from: string): string[] {
    return resolveSenderMids(from, this.senderLookup());
  }

  private senderLookup(): SenderLookup {
    const has: HasColumn = (column) => this.messageColumns().has(column);
    const marks = (ids: readonly string[]): string => ids.map(() => '?').join(',');
    return {
      own: this.ownMids(),
      people: () => this.loadPeople(),
      hasSent: (id) => this.safeGet(`SELECT 1 AS x FROM ${T.message} WHERE _from=? LIMIT 1`, [id]) !== undefined,
      activity: (ids) => {
        const out = new Map<string, { ms: number; chat: string }>();
        const rows = this.safeAll(
          `SELECT _from, max(_createdTime) AS t, _chatId FROM ${T.message} WHERE _from IN (${marks(ids)}) AND ${plainKindSql(has)} GROUP BY _from`,
          [...ids],
        );
        for (const row of rows) out.set(String(row._from), { ms: Number(row.t) || 0, chat: String(row._chatId ?? '') });
        return out;
      },
      withChat: (ids) => new Set(this.safeAll(`SELECT _id FROM ${T.chat} WHERE _id IN (${marks(ids)})`, [...ids]).map((row) => String(row._id))),
    };
  }

  /**
   * Global message search: every chat at once, newest first, each hit tagged with the chat
   * it came from. `query` matches what LINE shows for a message (lineSearchSql's visibleSql).
   * Checks run in line-cli's order (text words, unsent with text, type, sender, chat), so the same
   * mistake gives the same error.
   *
   * A full scan is deliberate: an FTS index would keep an extra copy of private message text on
   * disk, and SQLite's tokenizers mishandle short CJK queries.
   */
  searchMessages(opts: SearchOptions = {}): MessageHit[] {
    const limit = saneLimit(opts.limit, 50);
    const maps = this.nameMaps();
    const has: HasColumn = (column) => this.messageColumns().has(column);
    const where: string[] = [];
    const params: unknown[] = [];
    const query = (opts.query ?? '').trim();
    if (query) {
      const terms = searchTerms(query);
      if (terms.length === 0) throw new LineError('INVALID_ARGUMENT', `search text has no words: ${query}`);
      if (opts.contentType === 'unsent') {
        throw new LineError('INVALID_ARGUMENT', 'unsent messages have no text to search; use type: unsent without text');
      }
      this.ensureMatchFn();
      where.push(`${MATCH_FN}(${visibleSql(has)}, ?)`);
      params.push(terms.join('\x1f'));
    }
    if (opts.contentType) {
      const filter = typeFilter(opts.contentType, has);
      if (!filter) {
        throw new LineError('INVALID_ARGUMENT', `invalid type: ${opts.contentType} (valid: ${[...SEARCH_TYPE_NAMES, 'type_N'].join(', ')})`);
      }
      where.push(filter.clause);
      params.push(...filter.params);
    }
    const senders = opts.from ? this.resolveSenders(opts.from) : opts.senderMids;
    if (senders) {
      // An empty list (no own ids for "me") matches nothing, like `_from IN ()`.
      where.push(senders.length > 0 ? `_from IN (${senders.map(() => '?').join(',')})` : '0');
      params.push(...senders);
    }
    const chatId = opts.chat ? this.resolveChatId(opts.chat) : opts.chatId;
    if (chatId) {
      where.push('_chatId=?');
      params.push(chatId);
    } else if (opts.chatType) {
      const ids = this.chatIdsOfType(opts.chatType, maps);
      if (ids.length === 0) return [];
      where.push(`_chatId IN (${ids.map(() => '?').join(',')})`);
      params.push(...ids);
    }
    // Bounds arrive in seconds (0 = none); _createdTime is milliseconds.
    if (opts.sinceTs) {
      where.push('_createdTime>=?');
      params.push(opts.sinceTs * 1000);
    }
    if (opts.untilTs) {
      where.push('_createdTime<=?');
      params.push(opts.untilTs * 1000 + 999);
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
    const parse = this.rowParser();
    return rows.map((row) => {
      const chatId = String(row._chatId ?? '');
      const { name, type } = resolveChat(chatId, maps);
      return { chat_id: chatId, chat_name: name, chat_type: type, ...parse(row) };
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

  // _firstUnreadId is unreliable, so the newest unread_count messages are treated as unread;
  // a shortfall on disk is reported as missing_count.
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
    return this.listContacts({ query, limit: MAX_LIMIT }).contacts;
  }

  /** The contact list; see lineContacts.ts for the order and the matching. */
  listContacts(opts: { query?: string; limit?: number; includeMembers?: boolean }): ContactList {
    const text = (value: unknown): string => (value == null ? '' : String(value));
    const has: HasColumn = (column) => this.messageColumns().has(column);
    return listContactRows(opts, {
      own: this.ownMids(),
      official: this.nameMaps().official,
      chatActivity: new Map(this.loadChatRows().map((row) => [row.summary.chat_id, row.activityMs])),
      profile: this.safeAll(`SELECT _mid, _displayName FROM ${T.profile}`).map((row) => ({ mid: text(row._mid), name: text(row._displayName) })),
      friends: new Set(this.safeAll(`SELECT _mid FROM ${T.contact} WHERE _status IN (1, 2)`).map((row) => text(row._mid))),
      contacts: this.safeAll(`SELECT _mid, _displayName, _displayNameOverridden FROM ${T.contact} WHERE _mid<>''`)
        .map((row) => ({ mid: text(row._mid), name: text(row._displayName), nick: text(row._displayNameOverridden) })),
      members: () => {
        const communities = new Map(this.safeAll(`SELECT _mid, _name FROM ${T.squareCommunity}`).map((row) => [text(row._mid), text(row._name)]));
        return this.safeAll(`SELECT _squareMemberMid, _displayName, _squareMid FROM ${T.squareMember}`).map((row) => ({
          mid: text(row._squareMemberMid),
          name: text(row._displayName),
          community: communities.get(text(row._squareMid)) || text(row._squareMid),
        }));
      },
      lastSent: () => new Map(
        this.safeAll(`SELECT _from, max(_createdTime) AS t FROM ${T.message} WHERE ${plainKindSql(has)} GROUP BY _from`)
          .map((row) => [text(row._from), Number(row.t) || 0]),
      ),
    });
  }

  /**
   * What line_download / line_preview borrow (lineMediaRows.ts keeps their SQL): the guarded query,
   * the message columns, chat names, the contact names and the user's own ids, as of this call.
   */
  mediaSource() {
    const maps = this.nameMaps();
    return {
      all: (sql: string, params?: unknown[]) => this.safeAll(sql, params),
      hasColumn: (column: string) => this.messageColumns().has(column),
      chatName: (chatId: string) => resolveChat(chatId, maps).name,
      contacts: this.contactsMap(),
      ownMids: this.ownMids(),
      resolveChatId: (arg: string) => this.resolveChatId(arg),
    };
  }
}
