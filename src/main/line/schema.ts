/**
 * LINE PC database schema knowledge and pure row-parsing helpers.
 *
 * Everything here is pure (no database handle); the encrypted-DB access stays behind
 * reader.ts. The parsing mirrors line-cli, field for field, so the output matches line-cli's.
 */
import { localIsoString } from '../../shared/localTime';
import {
  anyInt, EVENT_TYPES, isMid, linkPreviews, metaBool, metaNumber, metaString, msToSec, NOTICE_KEYS,
  parseCall, parseEventInfo, parseLocation, parseMentions, parseMeta, parseReactions, storedName,
} from './lineMessageParts';
import type {
  Album, Call, EventInfo, GeoLocation, LinkPreview, Person, Reactions,
} from './lineMessageParts';

export type { Album, Call, GeoLocation, LinkPreview, Person, Reactions };

// Hard cap on any caller-supplied LIMIT. SQLite treats a negative LIMIT as "unlimited",
// so an unchecked value would leak the whole table from a tool that returns private chats.
export const MAX_LIMIT = 5000;

// LINE message `_contentType` codes. 6 is a call log, not a location (measured: its metadata is
// CAUSE/DURATION/RESULT/SESSION_ID/GC_*, no coordinates). 15 is a real location (data in the
// `_location` column, not metadata — the empty-metadata note was about metadata only). Code 18 is
// a chat notice handled as an event, not a content type, so it is not listed here. 16 is a
// post/album/note (`post`, as line-cli names it; `link`, its older name, is a search alias).
export const CONTENT_TYPE: Record<number, string> = {
  0: 'text',
  1: 'image',
  2: 'video',
  3: 'audio',
  6: 'call',
  7: 'sticker',
  13: 'contact',
  14: 'file',
  15: 'location',
  16: 'post',
  17: 'template',
  22: 'flex',
} as const;

/** Content types a caller may filter on, i.e. every name in CONTENT_TYPE. */
export const CONTENT_TYPE_FILTERS: readonly string[] = Object.values(CONTENT_TYPE);

export function contentTypeName(ct: number): string {
  return CONTENT_TYPE[ct] ?? `type_${ct}`;
}

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

// Official/bot accounts: `_contact._type` 8, `_contact._capableBuddy` 1, or a `_buddyDetail` row
// (the last two are read by the reader). Their chats are marketing-heavy and
// left out of the unread list by default.
export const OFFICIAL_CONTACT_TYPES: ReadonlySet<number> = new Set([8]);

export interface MessageRow {
  _from?: string | null;
  _createdTime?: number | null;
  _text?: string | null;
  _contentType?: number | null;
  _contentMetadata?: string | null;
  _id?: string | null;
  _contentInfo?: string | null;
  _eventInfo?: string | null;
  _location?: string | null;
  _urlPreview?: string | null;
  _reactions?: string | null;
  _reactionStatus?: string | null;
  _relatedMessageId?: string | null;
  _messageRelationType?: number | null;
  _type?: number | null;
  _attribute?: number | null;
  _toType?: number | null;
  _chunks?: string | Uint8Array | null;
}

/**
 * One message, in line-cli's field order (Go encodes struct fields in declaration order;
 * parseMessageRow pre-declares every key in this order so JSON.stringify prints them the same).
 * Optional fields are omitted when empty, booleans only when true; `sender` is always present.
 */
export interface ParsedMessage {
  id?: string;
  type: string;
  sender: string;
  sender_id?: string;
  content?: string;
  filename?: string;
  file_size?: number;
  url?: string;
  title?: string;
  description?: string;
  sent_at?: string;
  /** Only present, as true, on a message the user sent; omitted otherwise to keep payloads small. */
  from_me?: boolean;
  /** A message its sender took back; `original_type` says what it was. No content. */
  original_type?: string;
  /** A system row: joined|left|invited|removed|kicked|renamed, a raw code, notice or unknown. */
  event?: string;
  /** The members an event or @-mention is about. */
  targets?: Person[];
  /** True for an end-to-end encrypted message LINE itself could not decrypt (no content). */
  undecryptable?: boolean;
  /** Id of the message this one replies to. */
  reply_to?: string;
  /** The open-chat thread (t…) this message starts, or the thread a reply belongs to. */
  thread_id?: string;
  /** On a message that starts a thread: LINE's count of its replies (or, for a thread this PC has no record of, the replies read). */
  thread_replies?: number;
  forwarded?: boolean;
  mentions?: Person[];
  mentions_all?: boolean;
  reactions?: Reactions;
  edited?: boolean;
  location?: GeoLocation;
  call?: Call;
  link_previews?: LinkPreview[];
  album?: Album;
  duration_sec?: number;
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
interface ThreadRow {
  _threadMid: string;
  _chatMid: string;
}
interface MidTypeRow {
  _id: string;
  _midType?: number | null;
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
  /** A contact's own name, only when the user set a nickname for them (for name-match on it). */
  ownName: Map<string, string>;
  room: Set<string>;
  official: Set<string>;
  /** Thread chat id -> its parent open chat id. */
  thread: Map<string, string>;
  /** Chat id -> `_chat._midType`, when stored. */
  midType: Map<string, number>;
  /** The user's own account (the lone `_profile` row). */
  self: string;
  selfName: string;
}

export type ChatType = 'group' | 'open' | 'multi' | 'official' | 'personal' | 'thread' | 'self' | 'unknown';

/** The chat types a caller may filter on. */
export const CHAT_TYPE_FILTERS = ['personal', 'official', 'group', 'open', 'thread', 'self', 'multi', 'unknown'] as const;

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
 * LINE PC stores UTC epochs; render them in the host's local time so a `line_read` date filter
 * agrees with the user's own calendar. 0 / NULL / NaN = '', which callers
 * leave out of the JSON.
 */
export function tsToIso(ts: number | null | undefined): string {
  if (ts === null || ts === undefined || !Number.isFinite(ts) || ts === 0) return '';
  // `_createdTime` is epoch milliseconds (13-digit); tolerate a 10-digit seconds value.
  return localIsoString(new Date(ts > 1_000_000_000_000 ? ts : ts * 1000));
}

function displayName(row: { _displayName?: string | null; _displayNameOverridden?: string | null }): string {
  return (row._displayNameOverridden || row._displayName || '') as string;
}

/**
 * A file message's name: `_contentInfo.fileName`, else metadata FILE_NAME / fileName, else the
 * text (E2EE chats keep the name in `_text`).
 */
export function fileNameOf(contentInfo: string | null | undefined, metadata: string | null | undefined, text: string): string {
  return metaString(parseMeta(contentInfo), 'fileName') || metaString(parseMeta(metadata), 'FILE_NAME', 'fileName') || text;
}

/**
 * line-cli's message field order. Go encodes struct fields in declaration order; the tool output
 * re-orders every message by this list (lineOutput.ts), so how a message was built does not matter.
 */
export const MESSAGE_KEY_ORDER = [
  'id', 'type', 'sender', 'sender_id', 'content', 'filename', 'file_size', 'url', 'title', 'description',
  'sent_at', 'from_me', 'original_type', 'event', 'targets', 'undecryptable', 'reply_to', 'thread_id',
  'thread_replies', 'forwarded', 'mentions', 'mentions_all', 'reactions', 'edited', 'location', 'call',
  'link_previews', 'album', 'duration_sec',
] as const satisfies readonly (keyof ParsedMessage)[];

const NO_MIDS: ReadonlySet<string> = new Set();

/** `ownMids` are the ids the user sends under (see ownMidsOf); their messages are marked `from_me`. */
export function parseMessageRow(
  row: MessageRow,
  contactMap: Map<string, string>,
  ownMids: ReadonlySet<string> = NO_MIDS,
  name?: (mid: string) => string,
): ParsedMessage {
  // knownName is a mid's display name from the name tables, or ''.
  const resolve = name ?? ((mid: string) => {
    const known = contactMap.get(mid) || mid;
    return known === mid ? '' : known;
  });
  const from = row._from ?? '';
  const ci = parseMeta(row._contentInfo);
  const ev = parseEventInfo(row._eventInfo);
  const ct = row._contentType ?? 0;
  const kind = contentTypeName(ct);
  const meta = parseMeta(row._contentMetadata);

  // senderName: a name-table name, else the raw id; then the name LINE stored with the row.
  let sender = contactMap.get(from) || from;
  if (sender === from) sender = storedName(from, ci, ev) || sender;

  const msg: ParsedMessage = { type: kind, sender };
  if (row._id) msg.id = row._id;
  if (from) msg.sender_id = from;
  const sentAt = tsToIso(row._createdTime);
  if (sentAt) msg.sent_at = sentAt;
  if (from && ownMids.has(from)) msg.from_me = true;

  // Unsent: the sender took the message back. original_type says what it was; no content.
  if (row._attribute === 1) {
    msg.type = 'unsent';
    msg.original_type = kind;
    return msg;
  }
  // Event: a _type 3 system row, or a code-18 chat notice.
  if (row._type === 3 || ct === 18) {
    msg.type = 'event';
    parseEvent(msg, row, meta, ev, resolve);
    return msg;
  }

  const text = row._text ?? '';
  switch (kind) {
    case 'text': {
      if (text) msg.content = text;
      else if (row._type === 1 && (row._attribute ?? 0) === 0 && hasChunks(row)) msg.undecryptable = true;
      const previews = linkPreviews(row._urlPreview);
      if (previews.length > 0) msg.link_previews = previews;
      break;
    }
    case 'image': {
      const gid = metaString(meta, 'GID');
      if (gid) {
        msg.album = { id: gid };
        const index = metaNumber(meta, 'GSEQ');
        const total = metaNumber(meta, 'GTOTAL');
        if (index) msg.album.index = index;
        if (total) msg.album.total = total;
      }
      break;
    }
    case 'video':
    case 'audio': {
      const dur = metaNumber(meta, 'DURATION') ?? metaNumber(ci, 'duration');
      if (dur !== null && dur > 0) msg.duration_sec = msToSec(dur);
      break;
    }
    case 'sticker':
      msg.content = '[貼圖]';
      break;
    case 'file': {
      // E2EE chats keep the file name in _text rather than FILE_NAME metadata.
      const filename = fileNameOf(row._contentInfo, row._contentMetadata, text);
      if (filename) msg.filename = filename;
      if (text && text !== filename) msg.content = text;
      const size = metaNumber(meta, 'FILE_SIZE');
      if (size !== null) msg.file_size = size;
      break;
    }
    case 'post':
      // Post/album/note; keys measured on the real DB (postEndUrl/officialName/text).
      setIfAny(msg, 'url', metaString(meta, 'postEndUrl', 'url', 'linkUrl'));
      setIfAny(msg, 'title', metaString(meta, 'officialName', 'albumName', 'serviceName', 'title'));
      setIfAny(msg, 'description', metaString(meta, 'text', 'desc'));
      break;
    case 'template':
    case 'flex':
      // Bot template/flex messages: ALT_TEXT is the readable body (these usually have no _text).
      setIfAny(msg, 'content', metaString(meta, 'ALT_TEXT') || text);
      break;
    case 'contact':
      setIfAny(msg, 'content', metaString(meta, 'displayName') || text);
      break;
    case 'call':
      msg.call = parseCall(meta);
      if (text) msg.content = text;
      break;
    case 'location':
      if (text) msg.content = text;
      msg.location = parseLocation(row._location);
      break;
    default:
      // Any other or unknown type surfaces its raw text under the resolved kind.
      if (text) msg.content = text;
      break;
  }

  // Reply / forward. _messageRelationType is -1 when NULL (neither).
  const relatedId = row._relatedMessageId ?? '';
  const relationType = row._messageRelationType ?? -1;
  if (relatedId) {
    if (relationType === 3) msg.reply_to = relatedId;
    else if (relationType === 0) msg.forwarded = true;
  }

  const [mentions, mentionsAll] = parseMentions(meta, text, resolve);
  if (mentions.length > 0) msg.mentions = mentions;
  if (mentionsAll) msg.mentions_all = true;
  const reactions = parseReactions(row._reactionStatus ?? '', row._reactions ?? '');
  if (reactions) msg.reactions = reactions;
  if (metaBool(meta, 'EDITED')) msg.edited = true;
  return msg;
}

function hasChunks(row: MessageRow): boolean {
  const chunks = row._chunks;
  if (typeof chunks === 'string') return chunks.length > 0;
  return chunks instanceof Uint8Array && chunks.length > 0;
}

type OptionalText = 'content' | 'url' | 'title' | 'description';

/** Sets a text field only when it has text (Go's omitempty on a string). */
function setIfAny(msg: ParsedMessage, key: OptionalText, value: string): void {
  if (value) msg[key] = value;
}

function parseEvent(
  msg: ParsedMessage,
  row: MessageRow,
  meta: Record<string, unknown>,
  ev: EventInfo,
  name: (mid: string) => string,
): void {
  const person = (id: string, known: string): Person => {
    const n = known || name(id);
    return n ? { id, name: n } : { id };
  };
  const targets: Person[] = [];
  if (row._contentType === 18) {
    const key = metaString(meta, 'LOC_KEY');
    msg.event = NOTICE_KEYS[key] || key || 'notice';
    const args = metaString(meta, 'LOC_ARGS').split('\x1e');
    if (args.length < 2) return;
    if (msg.event === 'renamed') {
      msg.content = args[1];
      return;
    }
    for (const a of args.slice(1)) {
      for (const id of a.split('\x1f')) {
        if (isMid(id)) targets.push(person(id, ''));
      }
    }
    if (targets.length > 0) msg.targets = targets;
    return;
  }
  const code = anyInt(ev.type);
  if (code === null) msg.event = 'unknown';
  else if (EVENT_TYPES[code]) msg.event = EVENT_TYPES[code];
  else msg.event = `type_${code}`;
  for (const id of ev.midList) {
    if (id) targets.push(person(id, ev.names[id] ?? ''));
  }
  if (targets.length > 0) msg.targets = targets;
  if (typeof ev.param === 'string' && ev.param && msg.event === 'renamed') msg.content = ev.param;
}

export function buildNameMaps(input: {
  groups: GroupRow[];
  squares: SquareRow[];
  contacts: ContactRow[];
  rooms: RoomRow[];
  /** Official accounts the contact type misses (_capableBuddy=1, a _buddyDetail row). */
  officials?: string[];
  threads?: ThreadRow[];
  midTypes?: MidTypeRow[];
  profile?: ProfileRow[];
}): NameMaps {
  const group = new Map<string, string | null | undefined>();
  for (const row of input.groups) group.set(row._chatMid, row._chatName);

  const square = new Map<string, string | null | undefined>();
  for (const row of input.squares) square.set(row._squareChatMid, row._name);

  const contact = new Map<string, string>();
  const ownName = new Map<string, string>();
  const official = new Set<string>();
  for (const row of input.contacts) {
    contact.set(row._mid, displayName(row));
    const nick = row._displayNameOverridden || '';
    const name = row._displayName || '';
    if (nick && name && name !== nick) ownName.set(row._mid, name);
    if (row._type != null && OFFICIAL_CONTACT_TYPES.has(row._type)) official.add(row._mid);
  }
  for (const mid of input.officials ?? []) official.add(mid);

  const room = new Set<string>(input.rooms.map((row) => row._mid));
  const thread = new Map<string, string>();
  for (const row of input.threads ?? []) thread.set(row._threadMid, row._chatMid);
  const midType = new Map<string, number>();
  for (const row of input.midTypes ?? []) {
    if (row._midType != null) midType.set(row._id, row._midType);
  }
  const profile = input.profile ?? [];
  const self = profile[0]?._mid ?? '';
  const selfName = profile[0]?._displayName ?? '';

  return { group, square, contact, ownName, room, official, thread, midType, self, selfName };
}

// chatKind classifies a chat with no name-table row by _chat._midType, else by id prefix.
function chatKind(chatId: string, midType: number | undefined): ChatType {
  if (midType !== undefined) {
    switch (midType) {
      case 0: return 'personal';
      case 1: return 'multi';
      case 2: return 'group';
      case 4: return 'open';
      case 7: return 'thread';
    }
  }
  switch (chatId[0]) {
    case 'u': return 'personal';
    case 'r': return 'multi';
    case 'c': return 'group';
    case 'm': return 'open';
    case 't': return 'thread';
    default: return 'unknown';
  }
}

export function resolveChat(chatId: string, maps: NameMaps): { name: string; type: ChatType; parent?: string; alt?: string } {
  // Name-table hits are authoritative. Then the official/contact sets are checked BEFORE the
  // id-prefix fallback: line-cli classifies by id prefix first and consults the contact set only
  // when the prefix says personal, which is equivalent on real LINE data (1:1 ids are u…, groups
  // c…, open chats m…) but misclassifies the non-LINE-shaped ids test fixtures use. Checking the
  // sets first keeps both green and never changes a real chat's type.
  if (chatId && chatId === maps.self) return { name: maps.selfName || chatId, type: 'self' };
  if (maps.group.has(chatId)) return { name: maps.group.get(chatId) || chatId, type: 'group' };
  if (maps.square.has(chatId)) return { name: maps.square.get(chatId) || chatId, type: 'open' };
  if (maps.thread.has(chatId)) {
    const parent = maps.thread.get(chatId) ?? '';
    const parentName = maps.square.get(parent);
    return { name: parentName ? `${parentName} (thread)` : chatId, type: 'thread', parent };
  }
  if (maps.room.has(chatId)) return { name: '多人聊天', type: 'multi' };
  // alt is a contact's own name, set only when `name` is a nickname the user gave them, so a search
  // or send-by-name can also match their real name.
  const alt = maps.ownName.get(chatId);
  if (maps.official.has(chatId)) return { name: maps.contact.get(chatId) || chatId, type: 'official', ...(alt ? { alt } : {}) };
  if (maps.contact.has(chatId)) return { name: maps.contact.get(chatId) || chatId, type: 'personal', ...(alt ? { alt } : {}) };
  return { name: chatId, type: chatKind(chatId, maps.midType.get(chatId)) };
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
