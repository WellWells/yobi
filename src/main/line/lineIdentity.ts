/**
 * Chat and sender resolution. Pure functions over rows the reader loads, so the tiers, the
 * candidates and the error texts are the same as line-cli's without a database.
 *
 * line-cli's texts name its own flags; here they name the tool parameters instead ("search
 * --from" is line_search_messages with from), and are otherwise the same.
 */
import { LineError } from './errors';
import { isLineMid, tsToIso } from './schema';

/** At most this many candidates travel with an ambiguity error. */
export const MAX_CANDIDATES = 20;

/** The start of a chat_id, like a short git commit id: its kind letter and 3 or more hex digits. */
const CHAT_ID_PREFIX = /^[ucmtr][0-9a-f]{3,31}$/;

export function isChatIdPrefix(lowered: string): boolean {
  return CHAT_ID_PREFIX.test(lowered);
}

/** What resolution needs of a chat: its summary fields and, for a nicknamed contact, their own name. */
export interface ChatPickRow {
  summary: { chat_id: string; name: string; type: string; last_message_at?: string };
  alt: string;
}

export interface ChatCandidate {
  chat_id: string;
  name: string;
  type: string;
  last_message_at?: string;
}

const PERSON_HINT = 'a contact or open-chat member without a 1:1 chat; use line_search_messages with from to find their messages';

function ambiguous(message: string, hits: readonly ChatPickRow[]): LineError {
  let text = message;
  let shown = hits;
  if (hits.length > MAX_CANDIDATES) {
    text += ` (candidates: the ${MAX_CANDIDATES} most recently active)`;
    shown = hits.slice(0, MAX_CANDIDATES);
  }
  const candidates: ChatCandidate[] = shown.map(({ summary }) => ({
    chat_id: summary.chat_id,
    name: summary.name,
    type: summary.type,
    ...(summary.last_message_at ? { last_message_at: summary.last_message_at } : {}),
  }));
  return new LineError('CHAT_AMBIGUOUS', text, candidates);
}

function chatAmbiguous(arg: string, hits: readonly ChatPickRow[]): LineError {
  return ambiguous(`${hits.length} chats match: ${arg}; use chat_id`, hits);
}

// A chat_id prefix several chats start with, or that a chat name also contains: never pick one.
function prefixAmbiguous(arg: string, hits: readonly ChatPickRow[]): LineError {
  return ambiguous(
    `${hits.length} chats match ${arg} (the start of a chat_id or part of a name); add characters of the chat_id or pick from candidates`,
    hits,
  );
}

// The full name of a person without a 1:1 chat: chats that merely contain it are only candidates.
function personAmbiguous(arg: string, hits: readonly ChatPickRow[]): LineError {
  return ambiguous(`${arg} is ${PERSON_HINT}; ${hits.length} chats contain it in their name, use chat_id`, hits);
}

function chatNotFound(arg: string, person: boolean): LineError {
  return new LineError('CHAT_NOT_FOUND', `no chat matches: ${arg}${person ? ` (${PERSON_HINT})` : ''}`);
}

/**
 * Finds one chat by exact chat_id, then by name: exact, case-insensitive, a chat_id prefix (a chat
 * whose name contains the same text competes), then a name substring. `exactOnly` (send) stops
 * after the exact name. Threads and the user's own chat count only when no other chat matches,
 * except with exactOnly. Several hits in the deciding tier are CHAT_AMBIGUOUS, most recently active
 * first (`rows` comes in that order); so is any substring hit on the full name of a person with no
 * 1:1 chat. `isPerson` is asked only when needed: it loads every name the user knows.
 */
export function pickChat<R extends ChatPickRow>(
  arg: string,
  rows: readonly R[],
  exactOnly: boolean,
  isPerson: (arg: string) => boolean,
): R {
  const needle = arg.trim();
  if (!needle) throw new LineError('INVALID_ARGUMENT', 'chat is empty');
  for (const row of rows) {
    if (row.summary.chat_id === needle) return row;
  }
  const low = needle.toLowerCase();
  const tiers: ((name: string) => boolean)[] = [
    (name) => name === needle,
    (name) => name.toLowerCase() === low,
    (name) => name.toLowerCase().includes(low),
  ];
  const used = exactOnly ? tiers.slice(0, 1) : tiers;
  const nameMatches = (row: R, match: (name: string) => boolean): boolean =>
    (row.summary.name !== row.summary.chat_id && match(row.summary.name)) || (row.alt !== '' && match(row.alt));

  for (let tier = 0; tier < used.length; tier++) {
    const match = used[tier];
    if (tier === 2 && isChatIdPrefix(low)) {
      const hits: R[] = [];
      let prefixed = false;
      for (const row of rows) {
        const p = row.summary.chat_id.startsWith(low);
        if (p || nameMatches(row, match)) hits.push(row);
        prefixed ||= p;
      }
      if (prefixed) {
        if (hits.length === 1) return hits[0];
        throw prefixAmbiguous(needle, hits);
      }
    }
    const hits: R[] = [];
    const fallback: R[] = [];
    for (const row of rows) {
      if (!nameMatches(row, match)) continue;
      if (!exactOnly && (row.summary.type === 'thread' || row.summary.type === 'self')) fallback.push(row);
      else hits.push(row);
    }
    const use = hits.length > 0 ? hits : fallback;
    if (tier === 2 && use.length > 0 && isPerson(needle)) throw personAmbiguous(needle, use);
    if (use.length === 1) return use[0];
    if (use.length > 1) throw chatAmbiguous(needle, use);
  }
  throw chatNotFound(needle, isPerson(needle));
}

/** One name a sender id is known by. */
export interface Person {
  id: string;
  name: string;
  source: 'me' | 'contact' | 'open_chat_member';
  community?: string;
}

/** Whether `arg` is the id or, ignoring case, the full name of the user, a contact or a member. */
export function isPersonIn(people: readonly Person[], arg: string): boolean {
  const low = arg.toLowerCase();
  return people.some((p) => p.id === arg || (p.name !== '' && p.name.toLowerCase() === low));
}

/** What sender resolution reads from the database, loaded only when a step needs it. */
export interface SenderLookup {
  own: ReadonlySet<string>;
  people(): Person[];
  /** Whether the id has a stored message (a non-friend group member is in no name table). */
  hasSent(id: string): boolean;
  /** Each id's newest message that is neither an event nor unsent: when and in which chat. */
  activity(ids: readonly string[]): Map<string, { ms: number; chat: string }>;
  /** The ids that have a chat of their own (their 1:1 chat with the user). */
  withChat(ids: readonly string[]): Set<string>;
}

export interface SenderCandidate {
  id: string;
  name: string;
  source: string;
  community?: string;
  chat_id?: string;
  last_chat_id?: string;
  last_sent_at?: string;
}

const SOURCE_RANK: Record<string, number> = { me: 0, contact: 1, open_chat_member: 2 };

function sortedOwn(own: ReadonlySet<string>): string[] {
  return [...own].sort();
}

// The needle as an id or a comma-separated list of ids, each in a name table or with a stored
// message; null when it is not ids.
function knownIds(needle: string, people: readonly Person[], lookup: SenderLookup): string[] | null {
  const known = new Set(people.map((p) => p.id));
  const parts = needle.split(',');
  const ids: string[] = [];
  for (const part of parts) {
    const id = part.trim();
    if (!known.has(id) && !lookup.own.has(id)) {
      if (!isLineMid(id)) return null;
      if (!lookup.hasSent(id)) {
        if (parts.length === 1) return null;
        throw new LineError('SENDER_NOT_FOUND', `unknown sender id: ${id}`);
      }
    }
    ids.push(id);
  }
  return ids;
}

function senderAmbiguous(needle: string, hits: Person[], lookup: SenderLookup): LineError {
  const ids = hits.map((h) => h.id);
  const act = lookup.activity(ids);
  const ownChat = lookup.withChat(ids);
  const sorted = [...hits].sort((a, b) => {
    const am = act.get(a.id)?.ms ?? 0;
    const bm = act.get(b.id)?.ms ?? 0;
    if (am !== bm) return bm - am;
    const ar = SOURCE_RANK[a.source] ?? 0;
    const br = SOURCE_RANK[b.source] ?? 0;
    if (ar !== br) return ar - br;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  let message = `${hits.length} people match from ${needle}; pass one id from candidates, or several ids comma-separated`;
  let shown = sorted;
  if (sorted.length > MAX_CANDIDATES) {
    message += ` (candidates: the ${MAX_CANDIDATES} most recently active)`;
    shown = sorted.slice(0, MAX_CANDIDATES);
  }
  const candidates: SenderCandidate[] = shown.map((h) => {
    const a = act.get(h.id);
    const lastSentAt = tsToIso(a?.ms ?? 0);
    return {
      id: h.id,
      name: h.name,
      source: h.source,
      ...(h.community ? { community: h.community } : {}),
      ...(ownChat.has(h.id) ? { chat_id: h.id } : {}),
      ...(a?.chat ? { last_chat_id: a.chat } : {}),
      ...(lastSentAt ? { last_sent_at: lastSentAt } : {}),
    };
  });
  return new LineError('SENDER_AMBIGUOUS', message, candidates);
}

/**
 * The sender ids a `from` value means: "me" is every id the user posts under; a known id (or a
 * comma-separated list of them) is taken as-is; a name tries exact, then case-insensitive, then
 * substring, and a tier naming more than one person is SENDER_AMBIGUOUS with candidates.
 */
export function senderMids(nameOrMid: string, lookup: SenderLookup): string[] {
  const needle = nameOrMid.trim();
  if (!needle) throw new LineError('INVALID_ARGUMENT', 'from is empty');
  if (needle === 'me') return sortedOwn(lookup.own);
  const people = lookup.people();
  const ids = knownIds(needle, people, lookup);
  if (ids) return ids;
  const low = needle.toLowerCase();
  const tiers: ((name: string) => boolean)[] = [
    (name) => name === needle,
    (name) => name.toLowerCase() === low,
    (name) => name.toLowerCase().includes(low),
  ];
  for (const match of tiers) {
    const hits: Person[] = [];
    const seen = new Set<string>();
    let allMe = true;
    for (const p of people) {
      if (p.name !== '' && match(p.name) && !seen.has(p.id)) {
        seen.add(p.id);
        hits.push(p);
        allMe &&= lookup.own.has(p.id);
      }
    }
    if (hits.length === 0) continue;
    if (allMe) return sortedOwn(lookup.own);
    if (hits.length === 1) return [hits[0].id];
    throw senderAmbiguous(needle, hits, lookup);
  }
  throw new LineError('SENDER_NOT_FOUND', `no contact, open-chat member or sender id matches: ${needle}`);
}
