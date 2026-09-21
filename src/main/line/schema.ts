/**
 * LINE PC database schema knowledge and pure row-parsing helpers.
 *
 * Confirmed against LINE desktop 26.x: tables are `_`-prefixed, messages live in
 * `_message` keyed by `_chatId` and typed by `_contentType`, chat names resolve
 * across `_groupChat` / `_squareChat` / `_room` / `_contact`.
 *
 * Everything here is pure (no database handle), so the parsing/resolution logic is
 * unit-tested offline while the encrypted-DB access stays behind reader.ts.
 */

// Hard cap on any caller-supplied LIMIT. SQLite treats a negative LIMIT as "unlimited",
// so an unchecked value would leak the whole table from a tool that returns private chats.
export const MAX_LIMIT = 5000;

// LINE message `_contentType` codes, confirmed against a real 172k-message DB (2026-09-11).
// 6 is a CALL log, not a location: all 554 rows carry CAUSE/DURATION/RESULT/SESSION_ID/GC_*
// and not one coordinate field. 17/18/22 were missing entirely, which left 3,990 messages
// surfacing as `type_17`/`type_18`/`type_22`. 15 stays unmapped — its metadata is empty.
export const CONTENT_TYPE: Record<number, string> = {
  0: 'text',
  1: 'image',
  2: 'video',
  3: 'audio',
  6: 'call',
  7: 'sticker',
  13: 'contact',
  14: 'file',
  16: 'link',
  17: 'template',
  18: 'notice',
  22: 'flex',
} as const;

/** Content types a caller may filter on, i.e. every name in CONTENT_TYPE. */
export const CONTENT_TYPE_FILTERS: readonly string[] = Object.values(CONTENT_TYPE);

export function contentTypeCode(name: string): number | undefined {
  const found = Object.entries(CONTENT_TYPE).find(([, label]) => label === name);
  return found ? Number(found[0]) : undefined;
}

/**
 * Content types whose `_contentMetadata` holds text the user would search for: a shared
 * contact's name (13), a filename (14), a link's url/title/text (16), and the ALT_TEXT of a
 * bot template/flex message (17/22). Every other type's metadata is protocol noise — sticker
 * ids, OIDs, bot tracking tokens, sequence numbers — and matching it yields only false hits.
 */
export const SEARCHABLE_META_TYPES: readonly number[] = [13, 14, 16, 17, 22];

// Official/bot accounts (`_contact._type`); their chats are marketing-heavy and
// excluded from the unread list by default.
export const OFFICIAL_CONTACT_TYPES: ReadonlySet<number> = new Set([16]);

const URL_RE = /https?:\/\/[^\s]+/g;

export interface MessageRow {
  _from?: string | null;
  _createdTime?: number | null;
  _text?: string | null;
  _contentType?: number | null;
  _contentMetadata?: string | null;
}

export interface ParsedMessage {
  type: string;
  sender: string | undefined;
  content?: string | null;
  urls?: string[];
  filename?: string | null;
  file_size?: number | null;
  url?: string | null;
  title?: string | null;
  description?: string | null;
  sent_at: string | null;
  /** Only present, as true, on a message the user sent; omitted otherwise to keep payloads small. */
  from_me?: boolean;
}

interface GroupRow {
  _chatMid: string;
  _chatName?: string | null;
}
interface SquareRow {
  _squareChatMid: string;
  _name?: string | null;
}
interface ContactRow {
  _mid: string;
  _displayName?: string | null;
  _displayNameOverridden?: string | null;
  _type?: number | null;
}
interface RoomRow {
  _mid: string;
}
interface SquareMemberRow {
  _squareMemberMid: string;
  _displayName?: string | null;
}
interface ProfileRow {
  _mid: string;
  _displayName?: string | null;
}
interface SquareMembershipRow {
  _myMemberId?: string | null;
}

export interface NameMaps {
  group: Map<string, string | null | undefined>;
  square: Map<string, string | null | undefined>;
  contact: Map<string, string>;
  room: Set<string>;
  official: Set<string>;
}

export type ChatType = 'group' | 'open' | 'multi' | 'official' | 'personal' | 'unknown';

/** The chat types a caller may filter on ('unknown' is an internal fallback, not a filter). */
export const CHAT_TYPE_FILTERS = ['personal', 'group', 'multi', 'official', 'open'] as const;

export function isChatTypeFilter(value: string): boolean {
  return (CHAT_TYPE_FILTERS as readonly string[]).includes(value);
}

export function saneLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, MAX_LIMIT);
}

/**
 * Escapes a user-supplied substring for use inside a `LIKE '%…%' ESCAPE '\'` pattern.
 * Without this, a query containing `_` or `%` silently turns into a wildcard and returns
 * matches the caller never asked for.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Resolves "who is this" for a search: an exact mid wins, otherwise a case-insensitive
 * substring match over display names. Returns every match (the same display name can
 * belong to several mids) and an empty array when nobody matches — callers must treat
 * empty as "unresolved", never as "this person said nothing".
 */
export function matchSenderMids(nameOrMid: string, contactMap: Map<string, string>): string[] {
  const needle = nameOrMid.trim();
  if (!needle) return [];
  if (contactMap.has(needle)) return [needle];
  const lower = needle.toLowerCase();
  const out: string[] = [];
  for (const [mid, name] of contactMap) {
    if (name && name.toLowerCase().includes(lower)) out.push(mid);
  }
  return out;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * The host's UTC offset at that instant, as `+08:00`. Read per-instant rather than from a
 * constant so a DST transition shifts the rendered time with the calendar instead of against it.
 */
export function localOffsetLabel(at: Date): string {
  const minutes = -at.getTimezoneOffset();
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/**
 * LINE PC stores UTC epochs; these render in the HOST's local time. A fixed +08:00 used to be
 * simpler, but the `line_read` date filter made it wrong: a user outside Taipei asking for
 * "today" would get a window that disagrees with their own calendar. Vitest pins TZ, so the
 * suite stays deterministic.
 */
export function tsToIso(ts: number | null | undefined): string | null {
  if (ts === null || ts === undefined) return null;
  // `_createdTime` is epoch milliseconds (13-digit); tolerate a 10-digit seconds value.
  const at = new Date(ts > 1_000_000_000_000 ? ts : ts * 1000);
  const date = `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`;
  const time = `${pad2(at.getHours())}:${pad2(at.getMinutes())}:${pad2(at.getSeconds())}`;
  return `${date}T${time}${localOffsetLabel(at)}`;
}

export function extractUrls(text: string | null | undefined): string[] {
  if (!text) return [];
  return text.match(URL_RE) ?? [];
}

function displayName(row: { _displayName?: string | null; _displayNameOverridden?: string | null }): string {
  return (row._displayNameOverridden || row._displayName || '') as string;
}

function parseMeta(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function metaString(meta: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = meta[key];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

// LINE stores numeric metadata as strings (FILE_SIZE: "12345").
function metaNumber(meta: Record<string, unknown>, key: string): number | null {
  const value = meta[key];
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && value !== null && value !== undefined && value !== '' ? parsed : null;
}

const NO_MIDS: ReadonlySet<string> = new Set();

/** `ownMids` are the ids the user sends under (see ownMidsOf); their messages are marked `from_me`. */
export function parseMessageRow(
  row: MessageRow,
  contactMap: Map<string, string>,
  ownMids: ReadonlySet<string> = NO_MIDS,
): ParsedMessage {
  const parsed = parseMessageBody(row, contactMap);
  return row._from && ownMids.has(row._from) ? { ...parsed, from_me: true } : parsed;
}

function parseMessageBody(row: MessageRow, contactMap: Map<string, string>): ParsedMessage {
  const from = row._from ?? undefined;
  const sender = (from && contactMap.get(from)) || from;
  const ct = row._contentType ?? 0;
  const sent = tsToIso(row._createdTime);
  const kind = CONTENT_TYPE[ct] ?? `type_${ct}`;
  const meta = parseMeta(row._contentMetadata);

  if (kind === 'text') {
    const content = row._text ?? '';
    return { type: 'text', sender, content, urls: extractUrls(content), sent_at: sent };
  }
  if (kind === 'image') {
    return { type: 'image', sender, content: null, sent_at: sent };
  }
  if (kind === 'sticker') {
    return { type: 'sticker', sender, content: '[貼圖]', sent_at: sent };
  }
  if (kind === 'file') {
    // Only 296 of 1,077 real file messages carry FILE_NAME; 869 carry the name in _text
    // instead (E2EE chats keep it out of plaintext metadata), so keep both.
    return {
      type: 'file',
      sender,
      content: row._text ?? null,
      filename: metaString(meta, 'FILE_NAME', 'fileName'),
      file_size: metaNumber(meta, 'FILE_SIZE'),
      sent_at: sent,
    };
  }
  if (kind === 'link') {
    // Measured keys, not guessed ones: every real link message has postEndUrl, and the
    // url/linkUrl/title/desc names the first version looked for exist in no row at all.
    return {
      type: 'link',
      sender,
      url: metaString(meta, 'postEndUrl', 'url', 'linkUrl'),
      title: metaString(meta, 'officialName', 'albumName', 'serviceName', 'title'),
      description: metaString(meta, 'text', 'desc'),
      sent_at: sent,
    };
  }
  if (kind === 'template' || kind === 'flex') {
    // Bot rich/flex messages: ALT_TEXT is the human-readable body and the only content for
    // all 1,877 template messages (none has _text). Prefer it over the raw body.
    const alt = metaString(meta, 'ALT_TEXT');
    return { type: kind, sender, content: alt ?? row._text ?? null, sent_at: sent };
  }
  if (kind === 'contact') {
    return { type: 'contact', sender, content: metaString(meta, 'displayName') ?? row._text ?? null, sent_at: sent };
  }
  // video/audio/location/contact and any unknown type surface their raw text under
  // the resolved kind rather than being silently dropped.
  return { type: kind, sender, content: row._text ?? null, sent_at: sent };
}

export function buildNameMaps(input: {
  groups: GroupRow[];
  squares: SquareRow[];
  contacts: ContactRow[];
  rooms: RoomRow[];
}): NameMaps {
  const group = new Map<string, string | null | undefined>();
  for (const row of input.groups) group.set(row._chatMid, row._chatName);

  const square = new Map<string, string | null | undefined>();
  for (const row of input.squares) square.set(row._squareChatMid, row._name);

  const contact = new Map<string, string>();
  const official = new Set<string>();
  for (const row of input.contacts) {
    contact.set(row._mid, displayName(row));
    if (row._type != null && OFFICIAL_CONTACT_TYPES.has(row._type)) official.add(row._mid);
  }

  const room = new Set<string>(input.rooms.map((row) => row._mid));
  return { group, square, contact, room, official };
}

export function resolveChat(chatId: string, maps: NameMaps): { name: string; type: ChatType } {
  if (maps.group.has(chatId)) return { name: maps.group.get(chatId) || chatId, type: 'group' };
  if (maps.square.has(chatId)) return { name: maps.square.get(chatId) || chatId, type: 'open' };
  if (maps.room.has(chatId)) return { name: '多人聊天', type: 'multi' };
  if (maps.official.has(chatId)) return { name: maps.contact.get(chatId) || chatId, type: 'official' };
  if (maps.contact.has(chatId)) return { name: maps.contact.get(chatId) || chatId, type: 'personal' };
  return { name: chatId, type: 'unknown' };
}

export function buildContactsMap(input: {
  contacts: ContactRow[];
  squareMembers: SquareMemberRow[];
  profile?: ProfileRow[];
}): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of input.contacts) map.set(row._mid, displayName(row));
  // OpenChat senders are not in _contact, so back-fill from _squareMember without
  // overriding a friend's (possibly overridden) name.
  for (const row of input.squareMembers) {
    if (!map.has(row._squareMemberMid)) map.set(row._squareMemberMid, row._displayName ?? '');
  }
  // The user's own account is never a _contact row; its name lives only in _profile.
  for (const row of input.profile ?? []) {
    if (!map.has(row._mid)) map.set(row._mid, row._displayName ?? '');
  }
  return map;
}

/**
 * The ids the user sends under: the `_profile` mid, plus the member id held in each open chat.
 * Read from `_square._myMemberId`, not `_squareMember._myMember`, which can miss an active membership.
 */
export function ownMidsOf(input: { profile: ProfileRow[]; squares: SquareMembershipRow[] }): Set<string> {
  const mids = new Set<string>();
  for (const row of input.profile) {
    if (row._mid) mids.add(row._mid);
  }
  for (const row of input.squares) {
    if (row._myMemberId) mids.add(row._myMemberId);
  }
  return mids;
}

const LINE_MID = /^[a-z][0-9a-f]{32}$/;

/** A LINE id: one lowercase type letter and 32 hex digits. */
export function isLineMid(value: string): boolean {
  return LINE_MID.test(value);
}
