/**
 * The LINE tools that read this PC's database (other than line_get_history and line_get_unread,
 * in lineReadTool.ts): the same argument checks in the same order, the same reader calls, and the
 * notes line-cli prints on stderr, in its order. The LINE-not-running note comes first, when the
 * database opens.
 */
import { argOf, boolArg, CHAT_AND_TYPE, chatTypeArg, invalid, limitArg, notesOf, orderArg, pageEnds, stringArg } from './lineArgs';
import { DEFAULT_CONTACTS_LIMIT } from './lineContacts';
import { chatFreshness, historyNote, staleFor, staleNote, type Freshness } from './lineFreshness';
import { limitNote, pageNote, resolvedNote } from './lineNotes';
import { dropSenderIds, shapeAroundMessages, shapeSearchHits } from './lineOutput';
import type { ToolOutput } from './lineReadTool';
import type { LineServiceLike } from './lineService';
import { parseLineRange } from './lineTimeRange';
import { DEFAULT_FIND_FILE_LIMIT, STATS_GROUPINGS, type LineReader } from './reader';
import { saneLimit } from './schema';

export { LINE_READ_TOOL_DEFS } from './lineReadToolDefs';

type Args = Readonly<Record<string, unknown>>;

const MORE = 'raise limit (max 5000) or add a query';
const LINK_NOTE = 'note: type link is the older name of type post (album and note posts); for messages with a URL or link preview use type url';

// The reader with line-cli's first note: LINE stopped means the data ends at its last run.
async function open(service: LineServiceLike): Promise<{ reader: LineReader; notes: string[] }> {
  const reader = await service.getReader();
  return { reader, notes: (await service.stoppedNotes?.()) ?? [] };
}

function freshnessOf(reader: LineReader, chatId: string): Freshness | null {
  return chatFreshness(reader.access().all, chatId);
}

// The stale note with a read hint: the chat has newer activity than this PC stores.
function staleNotes(fr: Freshness | null, untilTs: number): string[] {
  return fr && staleFor(fr, untilTs) ? [staleNote(fr.chatId, fr, 'read')] : [];
}

function nextPage(order: 'asc' | 'desc'): string {
  return order === 'asc' ? 'newer: rerun with since <last sent_at>' : 'older: rerun with until <last sent_at>';
}

async function listChats(service: LineServiceLike, args: Args): Promise<ToolOutput<unknown>> {
  const chatType = chatTypeArg(argOf(args, 'chat_type', 'type'));
  const limit = limitArg(args.limit);
  const { reader, notes } = await open(service);
  const chats = reader.listChats({ query: stringArg(args.query), ...(chatType ? { chatType } : {}), limit });
  notes.push(...notesOf(limitNote(chats.length, saneLimit(limit, 50), MORE)));
  return { value: chats, notes };
}

async function getContacts(service: LineServiceLike, args: Args): Promise<ToolOutput<unknown>> {
  const limit = limitArg(args.limit);
  const includeMembers = boolArg(args.include_members, 'include_members');
  const { reader, notes } = await open(service);
  const res = reader.listContacts({ query: stringArg(args.query), limit, includeMembers });
  notes.push(...notesOf(limitNote(res.contacts.length, saneLimit(limit, DEFAULT_CONTACTS_LIMIT), MORE)));
  if (res.moreMembers > 0 && includeMembers) {
    notes.push(`note: ${res.moreMembers} more open-chat members match beyond limit; ${MORE}`);
  } else if (res.moreMembers > 0) {
    notes.push(`note: ${res.moreMembers} open-chat members also match; add include_members: true to list them`);
  }
  return { value: res.contacts, notes };
}

async function getMembers(service: LineServiceLike, args: Args): Promise<ToolOutput<unknown>> {
  const chat = stringArg(argOf(args, 'chat', 'chat_id'));
  if (!chat.trim()) throw invalid('line_get_members requires a chat_id or name');
  const limit = limitArg(args.limit);
  const { reader, notes } = await open(service);
  const res = reader.members(chat, limit);
  notes.push(...notesOf(resolvedNote(chat, res.chat)));
  if (res.note) notes.push(`note: ${res.note}`);
  if (res.total > res.members.length) notes.push(`note: returned ${res.members.length} of ${res.total} members; raise limit (max 5000)`);
  return { value: res.members, notes };
}

async function getStats(service: LineServiceLike, args: Args): Promise<ToolOutput<unknown>> {
  const chat = stringArg(argOf(args, 'chat', 'chat_id'));
  if (!chat.trim()) throw invalid('line_get_stats requires a chat_id or name');
  const by = args.by === undefined || args.by === null || args.by === '' ? 'sender' : stringArg(args.by);
  if (!(STATS_GROUPINGS as readonly string[]).includes(by)) throw invalid(`invalid by: ${by} (valid: ${STATS_GROUPINGS.join(', ')})`);
  const limit = limitArg(args.limit);
  const includeEvents = boolArg(args.include_events, 'include_events');
  const { sinceTs, untilTs } = parseLineRange(stringArg(args.since), stringArg(args.until));
  const { reader, notes } = await open(service);
  const res = reader.stats(chat, { by, sinceTs, untilTs, limit, includeEvents });
  const fr = freshnessOf(reader, res.chat_id);
  notes.push(...notesOf(resolvedNote(chat, { chat_id: res.chat_id, name: res.chat_name, type: res.chat_type })));
  notes.push(...staleNotes(fr, untilTs));
  if (res.total === 0) notes.push(...notesOf(historyNote(res.chat_id, fr, [], sinceTs, untilTs, 'read')));
  if (res.group_count > res.groups.length) {
    notes.push(`note: returned ${res.groups.length} of ${res.group_count} groups; raise limit (max 5000) to get them all`);
  }
  return { value: res, notes };
}

async function searchMessages(service: LineServiceLike, args: Args): Promise<ToolOutput<unknown>> {
  const text = stringArg(argOf(args, 'text', 'query'));
  const chat = stringArg(argOf(args, 'chat', 'chat_id'));
  const from = stringArg(argOf(args, 'from', 'sender'));
  const type = stringArg(argOf(args, 'type', 'content_type'));
  const since = stringArg(args.since);
  const until = stringArg(args.until);
  if (!text && !type && !from && !chat && !stringArg(args.chat_type) && !since && !until) {
    throw invalid('line_search_messages requires text or at least one filter');
  }
  const chatType = chatTypeArg(args.chat_type);
  if (chat && chatType) throw invalid(CHAT_AND_TYPE);
  const order = orderArg(args.order);
  const limit = limitArg(args.limit);
  const ids = boolArg(args.ids, 'ids');
  const { sinceTs, untilTs } = parseLineRange(since, until);
  const linkNote = type === 'link' ? [LINK_NOTE] : [];
  const { reader, notes } = await open(service);
  const hits = reader.searchMessages({
    query: text,
    ...(chat ? { chat } : {}),
    ...(from ? { from } : {}),
    ...(type ? { contentType: type } : {}),
    ...(chatType ? { chatType } : {}),
    sinceTs,
    untilTs,
    limit,
    order,
  });
  if (chat) notes.push(...staleNotes(freshnessOf(reader, reader.resolveChatId(chat)), untilTs));
  const [first, last] = pageEnds(hits);
  notes.push(...notesOf(pageNote(hits.length, saneLimit(limit, 50), first, last, nextPage(order))));
  return { value: shapeSearchHits(hits, ids), notes: [...linkNote, ...notes] };
}

async function readAround(service: LineServiceLike, args: Args): Promise<ToolOutput<unknown>> {
  const around = stringArg(argOf(args, 'message_id', 'id', 'around')).trim();
  const chatArg = stringArg(argOf(args, 'chat', 'chat_id'));
  if (!around) throw invalid('line_read_around requires message_id');
  if (stringArg(args.since) || stringArg(args.until)) throw invalid('line_read_around cannot be combined with since or until');
  const limit = limitArg(args.limit);
  const ids = boolArg(args.ids, 'ids');
  const { reader, notes } = await open(service);
  // Without a chat everything below works on the message's own chat.
  const chat = chatArg.trim() ? chatArg : reader.messageChat(around);
  const resolved = reader.resolveChatInfo(chat, false);
  const messages = reader.readAround(around, limit, resolved.chat_id);
  const fr = freshnessOf(reader, resolved.chat_id);
  notes.push(...notesOf(resolvedNote(chat, resolved), historyNote(resolved.chat_id, fr, messages.map((m) => m.id), 0, 0, 'read')));
  return { value: shapeAroundMessages(messages, ids), notes };
}

async function findFile(service: LineServiceLike, args: Args): Promise<ToolOutput<unknown>> {
  const chat = stringArg(argOf(args, 'chat', 'chat_id'));
  const from = stringArg(argOf(args, 'from', 'sender'));
  const chatType = chatTypeArg(args.chat_type);
  if (chat && chatType) throw invalid(CHAT_AND_TYPE);
  const order = orderArg(args.order);
  const limit = limitArg(args.limit);
  const noLocal = boolArg(args.no_local, 'no_local');
  const ids = boolArg(args.ids, 'ids');
  const { sinceTs, untilTs } = parseLineRange(stringArg(args.since), stringArg(args.until));
  const { reader, notes } = await open(service);
  const hits = reader.findFile({
    query: stringArg(args.query),
    ext: stringArg(args.ext),
    ...(chat ? { chat } : {}),
    ...(chatType ? { chatType } : {}),
    ...(from ? { from } : {}),
    sinceTs,
    untilTs,
    limit,
    order,
    localSearch: !noLocal,
  });
  const [first, last] = pageEnds(hits);
  notes.push(...notesOf(pageNote(hits.length, saneLimit(limit, DEFAULT_FIND_FILE_LIMIT), first, last, nextPage(order))));
  return { value: dropSenderIds(hits, ids), notes };
}

const CALLS: Readonly<Record<string, (service: LineServiceLike, args: Args) => Promise<ToolOutput<unknown>>>> = {
  line_status: async (service) => ({ value: await service.status(), notes: [] }),
  line_list_chats: listChats,
  line_get_contacts: getContacts,
  line_get_members: getMembers,
  line_get_stats: getStats,
  line_search_messages: searchMessages,
  line_read_around: readAround,
  line_find_file: findFile,
};

/** Runs one of these tools; null when `name` is not one of them. */
export function callLineReadTool(service: LineServiceLike, name: string, args: Args): Promise<ToolOutput<unknown>> | null {
  const call = Object.hasOwn(CALLS, name) ? CALLS[name] : undefined;
  return call ? call(service, args) : null;
}
