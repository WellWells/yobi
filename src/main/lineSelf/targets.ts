/**
 * Where a flow's LINE PC bot step may send: every group and friend LINE PC knows on this computer,
 * read from LINE's own database (the user picks one in the flow editor; the run sends there as the
 * user). Groups come from the chat list and LINE's group table (a group the user never opened on
 * this PC has no chat row yet); people are the user's friends and every 1:1 chat. Never the user's
 * own Keep chat, an open chat, a thread, a multi-person room, an official account or a friend the
 * user blocked (whose old 1:1 chat row stays). A chat whose key row says Letter Sealing is off is
 * left out: LINE PC can never send there.
 */
import type { LineSelfTargetOption } from '../../shared/types';
import type { LineReader } from '../line/reader';
import { MAX_LIMIT } from '../line/schema';
import { isLineDirectChat, isLineGroupChat } from './chats';

/** What the list needs of a LINE reader. */
export type LineSelfTargetReader = Pick<LineReader, 'myMid' | 'listChats' | 'listContacts' | 'access'>;

/** A store that opens a new read-only handle, so a group made a moment ago is in the list. */
export interface LineSelfTargetStore {
  openFresh: () => Promise<{ reader: LineSelfTargetReader; close: () => void }>;
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/** Letter Sealing per chat from the key table: true = a key row, false = sealing off; absent = no row. */
function keyRows(reader: LineSelfTargetReader): Map<string, boolean> {
  const rows = reader.access().all('SELECT _chatId, _e2eeEnabled FROM _chatE2EEPublicKeys');
  return new Map(rows.map((row) => [text(row._chatId), Number(row._e2eeEnabled) !== 0]));
}

/** Groups first, then people; within each, the most recently active first (never-opened ones last). */
function byKindThenActivity(a: LineSelfTargetOption, b: LineSelfTargetOption): number {
  if (a.type !== b.type) return a.type === 'group' ? -1 : 1;
  return (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '');
}

/** Every chat a LINE PC flow step can send to, as the reader sees it now. */
export function lineSelfTargets(reader: LineSelfTargetReader): LineSelfTargetOption[] {
  const ownMid = reader.myMid();
  const keys = keyRows(reader);
  // A friend the user blocked keeps the old 1:1 chat row; the user would never want to message them.
  const blocked = new Set(reader.access().all('SELECT _mid FROM _contact WHERE _status=2').map((row) => text(row._mid)));
  const out = new Map<string, LineSelfTargetOption>();
  const add = (id: string, name: string, type: 'group' | 'personal', lastMessageAt?: string): void => {
    if (!name || name === id || out.has(id) || keys.get(id) === false) return;
    out.set(id, { id, name, type, ...(lastMessageAt ? { lastMessageAt } : {}), sendable: keys.has(id) ? 'ready' : 'needsOpen' });
  };
  for (const chat of reader.listChats({ limit: MAX_LIMIT })) {
    if (chat.type === 'group' && isLineGroupChat(chat.chat_id)) add(chat.chat_id, chat.name, 'group', chat.last_message_at);
    else if (chat.type === 'personal' && isLineDirectChat(chat.chat_id) && chat.chat_id !== ownMid && !blocked.has(chat.chat_id)) {
      add(chat.chat_id, chat.name, 'personal', chat.last_message_at);
    }
  }
  for (const row of reader.access().all('SELECT _chatMid, _chatName FROM _groupChat')) {
    const id = text(row._chatMid);
    if (isLineGroupChat(id)) add(id, text(row._chatName).trim(), 'group');
  }
  const friends = new Set(reader.access().all('SELECT _mid FROM _contact WHERE _status=1').map((row) => text(row._mid)));
  for (const contact of reader.listContacts({ limit: MAX_LIMIT }).contacts) {
    const id = contact.contact_id;
    if (contact.type !== 'friend' || !friends.has(id) || id === ownMid || !isLineDirectChat(id)) continue;
    add(id, contact.display_name, 'personal');
  }
  return [...out.values()].sort(byKindThenActivity);
}

/** The list read through a new handle, closed whatever happens. */
export async function listLineSelfTargets(store: LineSelfTargetStore): Promise<{ ownId: string; ownName: string; targets: LineSelfTargetOption[] }> {
  const { reader, close } = await store.openFresh();
  try {
    const ownId = reader.myMid();
    const own = reader.listContacts({ query: ownId, limit: 1 }).contacts[0];
    const ownName = own?.display_name && own.display_name !== ownId ? own.display_name : '';
    return { ownId, ownName, targets: lineSelfTargets(reader) };
  } finally {
    close();
  }
}

/** One chat of the list by id, or null when LINE PC has no such group or friend. */
export async function findLineSelfTarget(store: LineSelfTargetStore, chatId: string): Promise<LineSelfTargetOption | null> {
  if (!isLineGroupChat(chatId) && !isLineDirectChat(chatId)) return null;
  const { targets } = await listLineSelfTargets(store);
  return targets.find((target) => target.id === chatId) ?? null;
}
