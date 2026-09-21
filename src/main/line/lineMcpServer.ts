/**
 * In-process MCP server exposing the LINE reader as tools.
 *
 * Deliberately native-free: it imports only the LineServiceLike TYPE and takes an
 * injected service, so the full tool surface (list + dispatch over InMemoryTransport)
 * is tested offline with a fixture-backed fake service. The native wiring that builds a
 * real LineService lives in lineConnection.ts.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { isLineError } from './errors';
import type { LineServiceLike } from './lineService';
import { CHAT_TYPE_FILTERS, CONTENT_TYPE_FILTERS, contentTypeCode, isChatTypeFilter, isLineMid } from './schema';

export const SERVER_NAME = 'LINE';
const SERVER_VERSION = '1.0.0';

export const LINE_TOOLS: Tool[] = [
  {
    name: 'line_locate_paths',
    description:
      'Detect the OS and return the LINE data directory, account hints, and file structure. Works on Windows and macOS.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'line_inspect_storage',
    description:
      'Report the LINE data directory footprint: total/cache bytes and the .db/.edb files with sizes and last-modified times. Works on Windows and macOS.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'line_list_chats',
    description:
      'List LINE chats (personal, group, multi-person, official account, open chat). The query matches the chat NAME only, never message content — to find a keyword or a person inside messages, use line_search_messages. Windows only. Reads the local encrypted DB, never LINE servers.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Fuzzy match on chat name (optional)' },
        chat_type: { type: 'string', description: `Filter: ${CHAT_TYPE_FILTERS.join(' | ')}`, enum: [...CHAT_TYPE_FILTERS] },
        limit: { type: 'number', description: 'Max results (default 50)' },
      },
    },
  },
  {
    name: 'line_get_history',
    description:
      'Get LINE chat messages from ONE chat. Omit since/until to get the most recent messages (the usual case) — just pass chat_id and optionally limit. Give since/until only to fetch a specific date range. This always returns a window, never the whole chat, so absence of something here is not evidence it was never said — use line_search_messages to look across all of history and all chats. Messages the user sent themselves carry from_me: true. Windows only.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat id from line_list_chats' },
        since: { type: 'string', description: "Optional range start, e.g. 2026-06-15 or 2026-06-15T00:00:00+08:00 (read in this computer's local time zone if no offset is given)" },
        until: { type: 'string', description: 'Optional range end (same format as since)' },
        limit: { type: 'number', description: 'Max messages (default 200)' },
      },
      required: ['chat_id'],
    },
  },
  {
    name: 'line_search_messages',
    description:
      'Search LINE messages across ALL chats at once — the default scope is global. Use this whenever you need to find a keyword anywhere, or everything one person said, without already knowing which chat it is in. Every hit carries chat_id/chat_name/chat_type, so you can then drill into that chat with line_get_history. The query matches the message text AND attachment details: filenames (so ".pdf" or a document name finds the file), link titles and urls, shared contact names, and the alt text of bot rich/flex messages. Combine with content_type to list one kind of thing, e.g. content_type="file" with query=".pdf". Some files keep their name only inside the encrypted body, so attachment search is good but not exhaustive. Messages the user sent themselves carry from_me: true. Returns newest first. Windows only.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Substring of the message text; any length, CJK included, case-insensitive' },
        sender: {
          type: 'string',
          description:
            "Sender name or mid. A name is resolved against your contacts, open-chat members and the user's own account; if it resolves to nobody the call fails rather than returning an empty result, so pass the sender's mid when the name is not in your contacts.",
        },
        chat_id: { type: 'string', description: 'Narrow to one chat (optional)' },
        chat_type: { type: 'string', description: `Filter: ${CHAT_TYPE_FILTERS.join(' | ')}`, enum: [...CHAT_TYPE_FILTERS] },
        content_type: {
          type: 'string',
          description: `Keep only one kind of message: ${CONTENT_TYPE_FILTERS.join(' | ')}`,
          enum: [...CONTENT_TYPE_FILTERS],
        },
        since: { type: 'string', description: "Optional range start, e.g. 2026-06-15 (read in this computer's local time zone if no offset is given)" },
        until: { type: 'string', description: 'Optional range end (same format as since)' },
        limit: { type: 'number', description: 'Max hits (default 50)' },
      },
    },
  },
  {
    name: 'line_get_unread',
    description:
      'List LINE chats with unread messages. Passive local read: never marks anything read or sends a read receipt. Reports available_count vs missing_count honestly (LINE syncs bodies lazily). Windows only.',
    inputSchema: {
      type: 'object',
      properties: {
        limit_chats: { type: 'number', description: 'Max chats (default 50)' },
        include_official: { type: 'boolean', description: 'Include official/bot accounts (default false)' },
        per_chat_limit: { type: 'number', description: 'Max messages per chat (default 200)' },
      },
    },
  },
  {
    name: 'line_get_contacts',
    description:
      "Look up LINE people: a name fragment, or an exact mid to identify one sender — a friend, an open-chat member, or the user's own account (marked is_me: true). A mid nobody on this computer has is an error, never an empty list. Windows only.",
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Name fragment or exact mid (optional)' } },
    },
  },
];

const BARE_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/;

// Lenient on purpose: accept a date ("2026-06-15") or datetime, with or without a timezone.
// A bare date/datetime is read in the HOST's local zone to match how tsToIso() renders
// timestamps, so the model is not forced into exact ISO 8601 with an offset every time.
// It is built from calendar parts rather than by appending the CURRENT offset, because in a
// DST zone "now"'s offset is the wrong one for a date six months away.
export function parseTimeToSeconds(value: string): number {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) throw new Error('Empty date value');
  if (/([+-]\d\d:?\d\d|Z)$/.test(trimmed)) {
    const ms = Date.parse(trimmed);
    if (Number.isNaN(ms)) throw new Error(`Invalid date: '${value}'`);
    return Math.floor(ms / 1000);
  }
  const parts = BARE_TIMESTAMP.exec(trimmed);
  if (!parts) throw new Error(`Invalid date: '${value}'`);
  const at = new Date(
    Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]),
    Number(parts[4] ?? 0), Number(parts[5] ?? 0), Number(parts[6] ?? 0),
  );
  if (Number.isNaN(at.getTime())) throw new Error(`Invalid date: '${value}'`);
  return Math.floor(at.getTime() / 1000);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

// An unrecognised chat_type would filter every chat out and return an empty list, which
// reads as "nothing found" instead of "bad argument". Reject it so the caller can correct it.
function optionalChatType(value: unknown): string | undefined {
  const type = asString(value);
  if (!type) return undefined;
  if (!isChatTypeFilter(type)) {
    throw new Error(`Invalid chat_type '${type}'. Use one of: ${CHAT_TYPE_FILTERS.join(', ')}.`);
  }
  return type;
}

// Same reason as chat_type: an unknown content_type must not masquerade as an empty result.
function optionalContentType(value: unknown): string | undefined {
  const type = asString(value);
  if (!type) return undefined;
  if (contentTypeCode(type) === undefined) {
    throw new Error(`Invalid content_type '${type}'. Use one of: ${CONTENT_TYPE_FILTERS.join(', ')}.`);
  }
  return type;
}

function requireString(value: unknown, field: string): string {
  const str = asString(value);
  if (!str) throw new Error(`Missing required argument: ${field}`);
  return str;
}

async function dispatch(service: LineServiceLike, name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'line_locate_paths':
      return service.locate();
    case 'line_inspect_storage':
      return service.inspect();
    case 'line_list_chats': {
      const reader = await service.getReader();
      return reader.listChats({ query: asString(args.query), chatType: optionalChatType(args.chat_type), limit: asNumber(args.limit) });
    }
    case 'line_get_history': {
      const reader = await service.getReader();
      const chatId = requireString(args.chat_id, 'chat_id');
      const since = asString(args.since);
      const until = asString(args.until);
      // No range given → the common case: most recent messages. A range (either bound) → window.
      if (!since && !until) {
        return reader.getLatestHistory(chatId, asNumber(args.limit));
      }
      const nowSeconds = Math.floor(Date.now() / 1000);
      return reader.getHistory(
        chatId,
        since ? parseTimeToSeconds(since) : 0,
        until ? parseTimeToSeconds(until) : nowSeconds,
        asNumber(args.limit),
      );
    }
    case 'line_search_messages': {
      const reader = await service.getReader();
      const sender = asString(args.sender);
      let senderMids: string[] | undefined;
      if (sender) {
        senderMids = reader.resolveSenders(sender);
        // An empty result here would read as "this person never said anything", which is
        // exactly the wrong conclusion. Fail loudly and point at the tool that can fix it.
        if (senderMids.length === 0) {
          throw new Error(
            `No contact or open-chat member matches sender '${sender}'. Use line_get_contacts to find the exact name, or pass the sender's mid.`,
          );
        }
      }
      const searchSince = asString(args.since);
      const searchUntil = asString(args.until);
      return reader.searchMessages({
        query: asString(args.query),
        senderMids,
        chatId: asString(args.chat_id),
        chatType: optionalChatType(args.chat_type),
        contentType: optionalContentType(args.content_type),
        sinceTs: searchSince ? parseTimeToSeconds(searchSince) : undefined,
        untilTs: searchUntil ? parseTimeToSeconds(searchUntil) : undefined,
        limit: asNumber(args.limit),
      });
    }
    case 'line_get_unread': {
      const reader = await service.getReader();
      return reader.getUnread({
        limitChats: asNumber(args.limit_chats),
        includeOfficial: args.include_official === true,
        perChatLimit: asNumber(args.per_chat_limit),
      });
    }
    case 'line_get_contacts': {
      const reader = await service.getReader();
      const query = (asString(args.query) ?? '').trim();
      const contacts = reader.getContacts(query);
      // An empty answer for an id reads as "nobody", and the caller then guesses who it was.
      if (contacts.length === 0 && isLineMid(query)) {
        throw new Error(
          `No friend, open-chat member, or account of the user has mid '${query}'. If it is a message sender, it is most likely a group member who is not a friend: this computer stores no name for them, so refer to them by this id and do not guess who it is.`,
        );
      }
      return contacts;
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export function createLineMcpServer(service: LineServiceLike): Server {
  const server = new Server({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: LINE_TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const { name } = req.params;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    try {
      const result = await dispatch(service, name, args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (err) {
      const body = isLineError(err)
        ? { error: err.code, message: err.message }
        : { error: 'ERROR', message: err instanceof Error ? err.message : String(err) };
      return { content: [{ type: 'text', text: JSON.stringify(body) }], isError: true };
    }
  });
  return server;
}
