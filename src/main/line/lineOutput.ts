/**
 * The output shaping line-cli applies before it prints JSON, so a tool's
 * JSON here is the same as line-cli's stdout. Reading a conversation takes sender, sent_at and
 * content: a 33-character sender_id and an 18-digit message id on every row are a large share of
 * the output and mostly noise, so they are left out where they tell the reader nothing. `ids`
 * (line-cli's global `--ids`) keeps every one of them.
 *
 * Rows are copied, never mutated: the reader's objects may be reused by other callers.
 *
 * Key order: Go encodes struct fields in declaration order, so every message is re-ordered by
 * line-cli's message fields (keys with an undefined value are left out, as Go's omitempty does).
 */
import { MESSAGE_KEY_ORDER } from './schema';

/** The chat fields a search hit puts before its message. */
const SEARCH_HIT_LEAD = ['chat_id', 'chat_name', 'chat_type'] as const;

/**
 * `row` with the listed keys first, in that order, then any other keys as they were; undefined
 * values are left out.
 */
export function orderKeys<T extends object>(row: T, order: readonly string[]): T {
  const source = row as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of order) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && !(key in out)) out[key] = value;
  }
  return out as T;
}

/** A message in line-cli's field order. */
export function orderMessage<T extends object>(message: T): T {
  return orderKeys(message, MESSAGE_KEY_ORDER);
}

/** A search hit: chat_id, chat_name, chat_type, then the message fields in order. */
export function orderSearchHit<T extends object>(hit: T): T {
  return orderKeys(hit, [...SEARCH_HIT_LEAD, ...MESSAGE_KEY_ORDER]);
}

interface SenderRow {
  sender: string;
  sender_id?: string;
}

interface MessageRow {
  id?: string;
  reply_to?: string;
}

function without<T extends object>(row: T, key: string): T {
  if (!(key in row)) return row;
  const copy = { ...row } as Record<string, unknown>;
  delete copy[key];
  return copy as T;
}

/**
 * The sender names two different senders share in these rows: only those rows keep sender_id, to
 * tell the two apart.
 */
function sharedSenderNames(rows: readonly SenderRow[]): Set<string> {
  const first = new Map<string, string>();
  const shared = new Set<string>();
  for (const row of rows) {
    const id = row.sender_id ?? '';
    const seen = first.get(row.sender);
    if (seen === undefined) first.set(row.sender, id);
    else if (seen !== id) shared.add(row.sender);
  }
  return shared;
}

/**
 * Leaves out sender_id on every row whose sender name belongs to a single sender in this output.
 * `scope` is every row the decision is made over (unread: the messages of all its chats).
 */
export function dropSenderIds<T extends SenderRow>(rows: readonly T[], ids: boolean, scope: readonly SenderRow[] = rows): T[] {
  if (ids) return [...rows];
  const shared = sharedSenderNames(scope);
  return rows.map((row) => (shared.has(row.sender) ? row : without(row, 'sender_id')));
}

/** The ids some message in these groups replies to: those messages keep their id. */
function repliedIds(groups: readonly (readonly MessageRow[])[]): Set<string> {
  const replied = new Set<string>();
  for (const group of groups) {
    for (const message of group) {
      if (message.reply_to) replied.add(message.reply_to);
    }
  }
  return replied;
}

/**
 * Leaves out the id of every message no message in these groups replies to; a replied-to message keeps its id so reply_to points at it.
 */
export function dropMessageIds<T extends MessageRow>(groups: readonly (readonly T[])[], ids: boolean): T[][] {
  if (ids) return groups.map((group) => [...group]);
  const replied = repliedIds(groups);
  return groups.map((group) => group.map((message) => (message.id && replied.has(message.id) ? message : without(message, 'id'))));
}

/** read (range): sender ids by name, message ids unless replied to; messages in Go field order. */
export function shapeReadMessages<T extends SenderRow & MessageRow>(messages: readonly T[], ids: boolean): T[] {
  return dropMessageIds([dropSenderIds(messages, ids)], ids)[0].map(orderMessage);
}

/** read --around: every message id stays (its output is found by id); sender ids by name. */
export function shapeAroundMessages<T extends SenderRow>(messages: readonly T[], ids: boolean): T[] {
  return dropSenderIds(messages, ids).map(orderMessage);
}

/** search: sender ids by name (hit ids always stay: the next step is read_around). */
export function shapeSearchHits<T extends SenderRow>(hits: readonly T[], ids: boolean): T[] {
  return dropSenderIds(hits, ids).map(orderSearchHit);
}

/**
 * unread: sender ids decided over the messages of every chat at once, and message ids kept only
 * where some message of any chat replies to them. `order` puts the chat's own keys in order.
 */
export function shapeUnreadChats<C extends { messages: (SenderRow & MessageRow)[] }>(
  chats: readonly C[], ids: boolean, order: (chat: C) => C = (chat) => chat,
): C[] {
  const all = chats.flatMap((chat) => chat.messages);
  const bySender = chats.map((chat) => dropSenderIds(chat.messages, ids, all));
  const byId = dropMessageIds(bySender, ids);
  return chats.map((chat, i) => order({ ...chat, messages: byId[i].map(orderMessage) }));
}
