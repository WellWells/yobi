/**
 * Definitions of the LINE tools that read this PC's database (other than line_get_history and
 * line_get_unread), written from line-cli's `help <command> --json`. The
 * first sentence of each description stands alone (the agent catalog shows only it); the rest is
 * what `tool_help` returns. Parameters are line-cli's flags; older names stay
 * accepted (`x-also-named`).
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ALSO_NAMED } from '../mcp/schemaAliases';
import { SEARCH_TYPE_NAMES } from './lineSearchSql';
import { STATS_GROUPINGS } from './reader';
import { CHAT_TYPE_FILTERS } from './schema';

const CHAT = { type: 'string', description: 'Chat id (preferred) or name', [ALSO_NAMED]: ['chat_id'] };
const CHAT_TYPE = {
  type: 'string',
  description: `Every chat of one type: ${CHAT_TYPE_FILTERS.join(' | ')} (not combinable with chat)`,
  enum: [...CHAT_TYPE_FILTERS],
};
const FROM = {
  type: 'string',
  description:
    'Sender: me (every id you post under), an id or several comma-separated (taken as-is), or a name (exact, then case-insensitive, then substring; a tier matching more than one person is SENDER_AMBIGUOUS with candidates)',
  [ALSO_NAMED]: ['sender'],
};
const SINCE = "Range start: YYYY-MM-DD, YYYYMMDD, 'YYYY-MM-DD HH:MM', RFC3339, unix seconds or milliseconds; this computer's local time unless an offset is given. A sent_at can be passed back as it is.";
const UNTIL = 'Range end (same formats; a bare date includes that whole day)';
const ORDER = { type: 'string', description: 'desc = newest first (default), asc = oldest first', enum: ['desc', 'asc'] };
const IDS = { type: 'boolean', description: 'Give sender_id on every row (by default only where two senders share a name)' };
const CHAT_RESOLVES =
  'A chat name resolves by exact chat_id, then exact name, case-insensitive name, then substring (threads and your own chat only when nothing else matches) and must pick one chat: otherwise CHAT_AMBIGUOUS lists candidates to pick from (never guess), and a note says which chat a name resolved to.';
const MESSAGE_FIELDS =
  'Messages: id, type, sender, sender_id, content, filename, file_size, url, title, description, sent_at, from_me, original_type, event, targets, undecryptable, reply_to, thread_id, thread_replies, forwarded, mentions, mentions_all, reactions, edited, location, call, link_previews, album, duration_sec (empty fields left out, booleans only when true). type: text|image|video|audio|call|sticker|contact|file|location|post|template|flex|event|unsent or type_N. sender is the display name; sender_id only on rows whose name two senders share (ids: true gives it everywhere). unsent = taken back (original_type says what it was). event rows are system rows (joined, left, renamed…); a raw notice code is a LINE system notice, do not guess its meaning.';
const LOCAL = "Windows only; reads this PC's LINE database, never LINE's server.";

export const LINE_READ_TOOL_DEFS: Tool[] = [
  {
    name: 'line_status',
    description:
      "Check whether LINE is running and how fresh this PC's LINE data is; call it first when results look old or empty. "
      + "Never scans LINE's memory or contacts LINE; uses only the cached key. line_running: the database only updates while LINE runs. db_modified_at/wal_modified_at: last database writes. newest_message_at/oldest_message_at: the stored message span. stale_chats: visible non-thread chats where LINE knows of newer activity than this PC stores (open them in LINE to sync). Database fields are left out when key_cached is false; note says why. Windows only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'line_list_chats',
    description:
      'List LINE chats, most recently active first; query matches a chat name or chat_id, never message text. '
      + "query matches a chat_id exactly or by a prefix of at least 4 characters, or a name by substring (a contact's own name too when you gave them a nickname). Types: personal (1:1 with a person), official (official account), group, open (open chat), thread (open-chat thread, named after its open chat), self (your own chat), multi, unknown. "
      + 'Output: chat_id, name, type, last_message_at, parent_chat_id (thread: its open chat), member_count (group), hidden, muted (notifications off), pinned (the last three only when true). '
      + `To find words or a person inside messages use line_search_messages. ${LOCAL}`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Part of a chat name, or a chat_id (or its first 4+ characters)' },
        chat_type: { ...CHAT_TYPE, description: `Only chats of this type: ${CHAT_TYPE_FILTERS.join(' | ')}`, [ALSO_NAMED]: ['type'] },
        limit: { type: 'number', description: 'Max chats (default 50, max 5000)' },
      },
    },
  },
  {
    name: 'line_get_contacts',
    description:
      'List LINE people: you (is_me), your contacts, and with include_members open-chat members; query filters by name or exact id. '
      + 'Order: you, contacts with a 1:1 chat (most recently active first), then other contacts; include_members merges in the open-chat members LINE has seen by their latest message. query matches a name substring (your nickname for them or their own name); an exact id returns that person from any source. A person\'s 1:1 chat_id is their contact_id. '
      + 'Output: contact_id, display_name (the name chats and senders show), profile_name (their own name, only when it differs), nickname (only when set), is_me, chat_id (their 1:1 chat), type (friend|official|other, contacts only), source (me|contact|open_chat_member), community (open-chat members). '
      + `Notes say when the limit cut the list and how many open-chat members also match. A group member who is not a contact has no name stored here: refer to them by id, never guess who it is. ${LOCAL}`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Part of a name, or an exact id' },
        limit: { type: 'number', description: 'Max people (default 200, max 5000)' },
        include_members: { type: 'boolean', description: 'Also list open-chat members (default false)' },
      },
    },
  },
  {
    name: 'line_get_members',
    description:
      'List who is in a LINE chat: group members and invitees, the open-chat members LINE has seen, or both people of a 1:1. '
      + `${CHAT_RESOLVES} Open-chat lists include people who left (see state) and are not complete; a group with no stored member list falls back to the people who sent messages; a note says either. Order: current members, admins, then most messages. `
      + `Output: id, name, is_me, role (group: creator; open chat: admin|co_admin|member), state (group: joined|invited; open chat: joined|left|kicked|banned|deleted|join_requested|rejected), invited, joined_at (group), chat_id (your 1:1 chat with them), message_count (their messages here, events and unsent excluded), last_sent_at. ${LOCAL}`,
    inputSchema: {
      type: 'object',
      properties: { chat: CHAT, limit: { type: 'number', description: 'Max members (default 200, max 5000)' } },
      required: ['chat'],
    },
  },
  {
    name: 'line_get_stats',
    description:
      "Count a LINE chat's messages without reading them, by sender (default), day, hour or type; fast even on huge chats. "
      + `${CHAT_RESOLVES} Only stored messages are counted (a note says when LINE knows of newer ones). by sender: most messages first; day: per local date, oldest first; hour: 0-23 local over the whole range, every hour that has messages (limit does not apply); type: most first. System events, notices and unsent messages are left out unless include_events (by type then counts them as event and unsent). Other groupings return at most limit groups; group_count is how many exist. `
      + `Output: chat_id, chat_name, chat_type, by, include_events, total, first_sent_at, last_sent_at, group_count, groups[] of count, first_sent_at, last_sent_at plus sender_id, sender, from_me (by sender), day, hour or type. ${LOCAL}`,
    inputSchema: {
      type: 'object',
      properties: {
        chat: CHAT,
        by: { type: 'string', description: `Grouping: ${STATS_GROUPINGS.join(' | ')} (default sender)`, enum: [...STATS_GROUPINGS] },
        since: { type: 'string', description: SINCE },
        until: { type: 'string', description: UNTIL },
        limit: { type: 'number', description: 'Max groups (default 100, max 5000)' },
        include_events: { type: 'boolean', description: 'Count system events, notices and unsent messages too (default false)' },
      },
      required: ['chat'],
    },
  },
  {
    name: 'line_search_messages',
    description:
      "Search every LINE chat's stored messages by words, sender, type or time; each hit has chat_id, chat_name and id. "
      + 'Matches what messages show: text (call rows included), file names, link preview titles and descriptions, post titles, contact card names, bot alt text, location addresses and a renamed chat\'s new name. Events and unsent messages never match text. Several words must all appear, in any order; words in "double quotes" must appear together as written. Case and full-/half-width are ignored. '
      + 'Needs text or at least one filter; since alone lists every chat\'s messages from then on. type: text excludes events and unsent; url = messages with a URL or link preview; post = album and note posts (link is its older name); notice = group notices; type_N = a raw content code. '
      + `Next steps: line_read_around with a hit's id for its context, line_get_history for the chat. A note says how to page. ${MESSAGE_FIELDS} ${LOCAL}`,
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Words that must all appear (any language); "double quotes" for an exact phrase', [ALSO_NAMED]: ['query'] },
        chat: { ...CHAT, description: 'Only this chat: chat id (preferred) or name' },
        from: FROM,
        type: {
          type: 'string',
          description: `Only one kind: ${SEARCH_TYPE_NAMES.join(' | ')} or type_N`,
          [ALSO_NAMED]: ['content_type'],
        },
        chat_type: CHAT_TYPE,
        since: { type: 'string', description: SINCE },
        until: { type: 'string', description: UNTIL },
        limit: { type: 'number', description: 'Max hits (default 50, max 5000)' },
        order: ORDER,
        ids: IDS,
      },
    },
  },
  {
    name: 'line_read_around',
    description:
      'Read the context of one LINE message id: about limit/2 messages before it, the message itself and the rest after, oldest first. '
      + 'Takes an id from line_search_messages, line_find_file, line_get_history or line_get_unread with ids: true, or a reply_to. chat may be left out; if given it must be the message\'s chat. Every message keeps its id here. '
      + `${MESSAGE_FIELDS} ${LOCAL}`,
    inputSchema: {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'The message id to centre on', [ALSO_NAMED]: ['id', 'around'] },
        chat: { ...CHAT, description: "Optional: the message's chat (id or name)" },
        limit: { type: 'number', description: 'Total messages (default 20, max 5000)' },
        ids: IDS,
      },
      required: ['message_id'],
    },
  },
  {
    name: 'line_find_file',
    description:
      'Find files shared in LINE chats by file name, newest first; local_path says where this PC already saved one. '
      + 'LINE keeps file content on its server and it expires (expired). local_path is where this PC saved the file, given only while it still exists with the same size; probable_local_path is a same-name, same-size guess in Downloads/Desktop/Documents/OneDrive; neither file is opened (no_local skips both checks). To fetch the file use line_download with its id. Page older with until <last sent_at>, or newer with order asc and since <last sent_at>. '
      + `Output: chat_id, chat_name, chat_type, sender, sender_id, filename, file_size, sent_at, expires_at, expired, e2ee, from_me, id, local_path, probable_local_path. ${LOCAL}`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Part of the file name' },
        ext: { type: 'string', description: 'File extension, such as pdf' },
        chat: { ...CHAT, description: 'Only this chat: chat id (preferred) or name' },
        chat_type: CHAT_TYPE,
        from: FROM,
        since: { type: 'string', description: SINCE },
        until: { type: 'string', description: UNTIL },
        limit: { type: 'number', description: 'Max files (default 200, max 5000)' },
        order: ORDER,
        no_local: { type: 'boolean', description: 'Skip looking for the file on this PC (default false)' },
        ids: IDS,
      },
    },
  },
];
