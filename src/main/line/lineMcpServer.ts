/**
 * In-process MCP server exposing the LINE reader as tools.
 *
 * Native-free: it imports only the LineServiceLike type and takes an injected service. The native
 * wiring that builds a real LineService lives in lineConnection.ts.
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createToolServer, ToolError, ToolResultWithNotes, type ToolServer } from '../mcp/inProcessServer';
import { ALSO_NAMED } from '../mcp/schemaAliases';
import { isLineError } from './errors';
import { REACTION_NAMES } from './lineMessageParts';
import { argOf, boolArg, invalid, limitArg, stringArg } from './lineArgs';
import type { LineServiceLike } from './lineService';
import { replyToArgument } from './lineSendReply';
import { callLineDownload, callLinePreview, LINE_MEDIA_TOOLS } from './lineMediaTools';
import { shapeReadMessages, shapeUnreadChats } from './lineOutput';
import { callLineReadTool, LINE_READ_TOOL_DEFS } from './lineReadTools';
import { checkMaxThreads, readHistory, readUnreadChats, type OnlineDeps } from './lineReadTool';
import { parseLineRange } from './lineTimeRange';

export const SERVER_NAME = 'LINE';

const SINCE = "Range start: YYYY-MM-DD, YYYYMMDD, 'YYYY-MM-DD HH:MM', RFC3339, unix seconds or milliseconds; this computer's local time unless an offset is given. A sent_at can be passed back as it is.";
const UNTIL = 'Range end (same formats; a bare date includes that whole day)';
const OFFLINE = { type: 'boolean', description: "Only what this computer stores: never contact LINE's server (default false)" };
const IDS_READ = {
  type: 'boolean',
  description: 'Give every message its id and sender_id (by default ids only where another message replies to it, sender_id only where two senders share a name); needed for line_read_around, line_download or reply_to',
};

export const LINE_TOOLS: Tool[] = [
  {
    name: 'line_locate_paths',
    description:
      'Detect the OS and return the LINE data directory, account hints, and file structure. Works on Windows and macOS.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'line_inspect_storage',
    description:
      'Report the LINE data directory footprint: total/cache bytes and the .db/.edb files with sizes and last-modified times. Works on Windows and macOS.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  ...LINE_READ_TOOL_DEFS,
  {
    name: 'line_get_history',
    description:
      "Read one LINE chat's messages, oldest first: the newest ones by default, or a since/until range. " +
      "Without since/until: the newest limit messages (default 200). With since: the first N from since on; with only until: the last N up to until (default 500 with a range). Page older with until = the first sent_at, newer with since = the last sent_at (the boundary second repeats, so dedupe by id, or without ids: true by sent_at, sender and content); if a full page shares one sent_at, raise limit instead. This always returns a window, never the whole chat, so absence of something here is not evidence it was never said — use line_search_messages to look across all of history and all chats. Messages the user sent themselves carry from_me: true. Notes before the JSON say which chat a name resolved to, when the limit was reached and what this computer does not store. " +
      "Open chats (m…) and threads (t…): LINE for PC never stores thread replies, and stores an open chat's messages only as far as it has synced, so this tool reads the rest from LINE's server (LINE must be running and signed in; it only reads, nothing changes on LINE). A thread: its first message and every reply. An open chat: its messages, including the ones this computer lacks, with the replies of its threads active in the span merged in by sent_at. A reply has thread_id; the message that starts a thread has thread_id and thread_replies. limit counts the open chat's own messages, not replies. At most max_threads threads are read (default 20), most recently active first, about one second per call to LINE's server: read only what the user needs. LINE's server keeps thread replies for only about 5 months, so a thread can have fewer replies than thread_replies (a note says so): tell the user rather than retrying. If LINE's server cannot be reached, it still returns what this computer stores and a note says what is missing; offline: true never contacts LINE's server. Messages read from LINE's server are not stored on this computer: line_search_messages and line_get_stats do not see them, and line_read_around cannot find their ids. Windows only.",
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: {
          type: 'string',
          description: 'Chat id from line_list_chats, or a chat name (exact id, then exact name, case-insensitive name, then substring; it must pick one chat, otherwise CHAT_AMBIGUOUS lists candidates to pick from)',
          [ALSO_NAMED]: ['chat'],
        },
        since: { type: 'string', description: SINCE },
        until: { type: 'string', description: UNTIL },
        limit: { type: 'number', description: 'Max messages (default 200, 500 with since/until, max 5000)' },
        max_threads: { type: 'number', description: 'Open chats: how many threads to read replies of (default 20, max 100)' },
        offline: OFFLINE,
        ids: IDS_READ,
      },
      required: ['chat_id'],
    },
  },
  {
    name: 'line_get_unread',
    description:
      "List LINE chats with unread messages and those messages, oldest first, without marking anything read. " +
      "Uses LINE's own read boundary and never sends a read receipt. boundary says where they start: first_unread (groups, 1:1): at LINE's first unread message; read_marker (open chats, or when the first unread message is not on this computer): after the user's last read message; unread_count: LINE's marker lags behind, so only the newest unread_count after it; not_stored: LINE's boundary message is not on this computer, so no messages; none: LINE stored no boundary, so the newest unread_count stored messages, which may already be read. System events (joins, leaves, unsent markers, notices) in the range are returned but neither counted nor charged to per_chat_limit. available_count: unread messages stored on this computer; missing_count: unread_count - available_count; fully_synced: boundary first_unread or read_marker, nothing missing, not stale and LINE running. stale: LINE knows of activity (last_activity_at) newer than the newest stored message (newest_stored_at): open the chat in LINE to sync. An open chat's unread messages LINE for PC has not synced are read from LINE's server (LINE must be running; offline: true skips it), and then count as available and the chat is not stale. muted: notifications off. Official accounts are skipped unless include_official, hidden chats unless include_hidden (then marked hidden). Takes no chat: for one chat use line_get_history. Windows only.",
    inputSchema: {
      type: 'object',
      properties: {
        limit_chats: { type: 'number', description: 'Max chats (default 50, max 5000)' },
        include_official: { type: 'boolean', description: 'Include official/bot accounts (default false)' },
        include_hidden: { type: 'boolean', description: 'Include chats hidden from LINE\'s chat list (default false)' },
        per_chat_limit: { type: 'number', description: 'Max unread messages per chat, events not counted (default 200, max 5000)' },
        offline: OFFLINE,
        ids: IDS_READ,
      },
    },
  },
  {
    name: 'line_send',
    description:
      'Send a LINE text or files AS THE USER to a one-to-one chat or group: dry_run first, then the real send (the app asks the user). '
      + 'Steps: (1) call with dry_run: true; (2) call again with the same to, message, file and reply_to, without dry_run: the app shows the user the recipient, the text and the files and asks before anything is sent, so never ask the user to approve it yourself. '
      + 'Prefer the chat_id for to; a name must match exactly one chat. Open chats and threads are refused (INVALID_ARGUMENT lists that chat as the candidate). '
      + "reply_to sends it as LINE's Reply, quoting a message someone sent in the same chat: an id from line_search_messages or line_read_around, or from line_get_history / line_get_unread with ids: true. "
      + 'mention tags group members with a word written in the text: write @Name in message, and pass a member id, a member\'s exact name, or <word>=<id> when the word differs from the name here; mention_all with @All in the text tags everyone. Each person gets a notification, so tag only who the user asked for. '
      + 'End-to-end encrypted. Text: at most 10000 characters; a leading BOM is removed, CRLF and CR become LF, trailing line breaks are trimmed; other control characters are refused. '
      + "Files: up to 50 in file, each at most 1 GB (1 GB a day in all), each its own message, after the text when message is given too. JPEG and PNG go as photos (kind image), H.264 MP4 as videos (kind video), other videos as files (a note says why; as_file sends them all as files); a JPEG goes without its location (gps_removed). Only types LINE allows: an INVALID_ARGUMENT naming types such as .exe means put them in a ZIP file. LINE deletes a file from its server after 7 days (expires_at). A send that stops at a failed file still returns every file, with error and message at the top: files with status sent were delivered, never resend them; not_sent ones were not tried. "
      + 'sent:true means LINE accepted it, even with verified:false: never resend. SEND_UNCERTAIN: check line_get_history before any retry. DUPLICATE_SEND: the same text or file went to this chat within 10 minutes; pass allow_duplicate only if the user really wants it sent again. '
      + 'Send at a human pace, never in bulk: LINE can restrict accounts that use unofficial clients. If the error says Windows blocked the connection, tell the user (the firewall must allow the program it names); do not retry. Windows only.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Chat id (preferred) or exact name of a one-to-one chat or group' },
        message: { type: 'string', description: 'The text to send (UTF-8, at most 10000 characters); with file, sent first. Needed unless file is given' },
        file: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: paths of files on this computer to send, in order (up to 50; in the output folder, Documents, Downloads or Desktop)',
        },
        as_file: { type: 'boolean', description: 'Send photos and videos in file as files (default false)' },
        reply_to: {
          type: 'string',
          description: "Optional: id (digits) of a message in the same chat to reply to, quoting it as LINE's Reply does; from line_search_messages, line_read_around, or line_get_history / line_get_unread with ids: true",
        },
        mention: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional, groups only, not with file: members to tag, each a member id, an exact name, or <word>=<id>; the text must contain @ and that word',
        },
        mention_all: { type: 'boolean', description: 'Optional, groups only, not with file: tag everyone; the text must contain @All' },
        dry_run: { type: 'boolean', description: 'Build and show the message without sending (default false); always do this first' },
        allow_duplicate: { type: 'boolean', description: 'Send even if the same text went to this chat in the last 10 minutes' },
        confirm: { type: 'string', description: "One line in the user's language naming the recipient and what is being sent, shown before a real send" },
      },
      required: ['to'],
    },
  },
  {
    name: 'line_react',
    description:
      'React to a LINE message AS THE USER, or remove your reaction: dry_run first, then the real call (the app asks the user). '
      + 'One-to-one chats and groups only. '
      + 'Steps: (1) call with dry_run: true and check the message it shows; (2) call again with the same arguments, without dry_run. '
      + 'id comes from line_search_messages or line_read_around, or from line_get_history / line_get_unread with ids: true; it must be a stored message of that chat. Give reaction or remove, not both. '
      + 'sent:true means LINE accepted it, even with verified:false. SEND_UNCERTAIN: check line_get_history before any retry. Windows only.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Chat id (preferred) or exact name of a one-to-one chat or group' },
        id: { type: 'string', description: 'Id (digits) of the message, as a string' },
        reaction: { type: 'string', enum: Object.values(REACTION_NAMES), description: 'The reaction to add' },
        remove: { type: 'boolean', description: 'Remove your reaction instead (default false)' },
        dry_run: { type: 'boolean', description: 'Show the message without reacting (default false); always do this first' },
        confirm: { type: 'string', description: "One line in the user's language naming the message and the reaction, shown before the real call" },
      },
      required: ['to', 'id'],
    },
  },
  {
    name: 'line_unsend',
    description:
      'Take back one of the user\'s own LINE messages: dry_run first, then the real call (the app asks the user). '
      + 'One-to-one chats and groups only. '
      + 'Steps: (1) call with dry_run: true and check the message it shows; (2) call again with the same arguments, without dry_run. '
      + 'id comes from line_search_messages or line_read_around, or from line_get_history / line_get_unread with ids: true; a message someone else sent is refused. How old a message may be is LINE\'s rule: the error says so when it is too late. '
      + 'This cannot be undone. sent:true means LINE accepted it, even with verified:false. SEND_UNCERTAIN: check line_get_history before any retry. Windows only.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Chat id (preferred) or exact name of a one-to-one chat or group' },
        id: { type: 'string', description: 'Id (digits) of the message, as a string' },
        dry_run: { type: 'boolean', description: 'Show the message without unsending it (default false); always do this first' },
        confirm: { type: 'string', description: "One line in the user's language naming the message, shown before the real call" },
      },
      required: ['to', 'id'],
    },
  },
  ...LINE_MEDIA_TOOLS,
];

/**
 * A tool's JSON plus the notes line-cli prints on stderr (paging hints, resolved names, what LINE's
 * server could not give), each one line starting `note:` or `warning:`. No notes = the bare JSON.
 */
export function withNotes(value: unknown, notes: readonly string[]): unknown {
  return notes.length > 0 ? new ToolResultWithNotes(value, notes) : value;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Missing required argument: ${field}`);
  return value;
}

// LINE's server for the reads of open chats and threads; a cancelled call makes no further calls.
function onlineDeps(service: LineServiceLike, signal?: AbortSignal): OnlineDeps {
  return { connect: service.connectSquare ? () => service.connectSquare!() : undefined, signal };
}

async function getHistory(service: LineServiceLike, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const chat = stringArg(argOf(args, 'chat_id', 'chat'));
  if (!chat.trim()) throw invalid('line_get_history requires a chat_id or name');
  const limit = limitArg(args.limit);
  const maxThreads = checkMaxThreads(args.max_threads);
  const offline = boolArg(args.offline, 'offline');
  const ids = boolArg(args.ids, 'ids');
  const { sinceTs, untilTs } = parseLineRange(stringArg(args.since), stringArg(args.until));
  const reader = await service.getReader();
  const stopped = (await service.stoppedNotes?.()) ?? [];
  const out = await readHistory(reader, { chat, sinceSec: sinceTs, untilSec: untilTs, limit, offline, maxThreads }, onlineDeps(service, signal));
  return withNotes(shapeReadMessages(out.value, ids), [...stopped, ...out.notes]);
}

async function getUnread(service: LineServiceLike, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  if (argOf(args, 'chat_id', 'chat') !== undefined) {
    throw invalid('line_get_unread takes no chat or other argument; use line_get_history with chat_id <chat_id> for one chat, or pick it from the output by chat_id');
  }
  const limitChats = limitArg(args.limit_chats, 'limit_chats');
  const perChatLimit = limitArg(args.per_chat_limit, 'per_chat_limit');
  const includeOfficial = boolArg(args.include_official, 'include_official');
  const includeHidden = boolArg(args.include_hidden, 'include_hidden');
  const offline = boolArg(args.offline, 'offline');
  const ids = boolArg(args.ids, 'ids');
  const reader = await service.getReader();
  const stopped = (await service.stoppedNotes?.()) ?? [];
  const out = await readUnreadChats(
    reader,
    { limitChats, perChatLimit, includeOfficial, includeHidden, offline, lineStopped: stopped.length > 0 },
    onlineDeps(service, signal),
  );
  return withNotes(shapeUnreadChats(out.value, ids), [...stopped, ...out.notes]);
}

/** `file`: one path or a list (line-cli's repeated --file); an empty string is not a path given. */
function fileArgs(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((entry) => {
    if (typeof entry !== 'string') throw invalid('file takes the paths of files on this computer, as strings');
    return entry;
  }).filter((entry) => entry !== '');
}

// Send: text, or files (each its own message, after the text when there is one).
async function callLineSend(service: LineServiceLike, args: Record<string, unknown>): Promise<unknown> {
  const notes: string[] = [];
  const notify = (note: string): number => notes.push(note);
  const to = requireString(args.to, 'to');
  const files = fileArgs(args.file);
  const hasText = typeof args.message === 'string';
  if (!hasText && files.length === 0) throw invalid('line_send requires message or file');
  const asFile = boolArg(args.as_file, 'as_file');
  if (asFile && files.length === 0) throw invalid('as_file applies to file; give the files to send with file');
  const replyTo = replyToArgument(args.reply_to);
  const mention = listArgument(args.mention);
  const mentionAll = boolArg(args.mention_all, 'mention_all');
  if (mention.length > 0 || mentionAll) {
    if (files.length > 0) throw invalid('mention and mention_all apply to a text message; send the files in a separate call');
    if (mention.includes('')) throw invalid('mention needs a member id or exact name');
  }
  const common = {
    to,
    dryRun: args.dry_run === true,
    allowDuplicate: args.allow_duplicate === true,
    ...(replyTo !== undefined ? { replyTo } : {}),
    notify,
  };
  if (files.length === 0) {
    // An empty text is the send's own INVALID_ARGUMENT ("message text is empty"), as in line-cli.
    return withNotes(await service.send({ ...common, text: args.message as string, mention, mentionAll }), notes);
  }
  if (!service.sendFiles) throw invalid('sending files is not available here');
  const text = hasText && args.message !== '' ? (args.message as string) : undefined;
  return withNotes(await service.sendFiles({ ...common, files, ...(text !== undefined ? { text } : {}), asFile }), notes);
}

// A list argument: one value is a list of one (models often send a bare string).
function listArgument(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]).map((entry) => (typeof entry === 'string' ? entry : ''));
}

// line_react and line_unsend name a message by a string id: an 18-digit number has already lost its
// last digits to JSON, and could name another message.
function messageIdArgument(value: unknown): string {
  if (typeof value === 'string' && value !== '') return value;
  throw invalid('id needs a LINE message id (digits), as a string');
}

async function callLineReact(service: LineServiceLike, args: Record<string, unknown>): Promise<unknown> {
  if (!service.react) throw invalid('reacting is not available here');
  const reaction = typeof args.reaction === 'string' ? args.reaction : '';
  const remove = boolArg(args.remove, 'remove');
  if ((reaction === '') === !remove) throw invalid('line_react needs either reaction or remove');
  return service.react({
    to: requireString(args.to, 'to'), id: messageIdArgument(args.id), ...(remove ? { remove } : { reaction }), dryRun: args.dry_run === true,
  });
}

async function callLineUnsend(service: LineServiceLike, args: Record<string, unknown>): Promise<unknown> {
  if (!service.unsend) throw invalid('unsending is not available here');
  return service.unsend({ to: requireString(args.to, 'to'), id: messageIdArgument(args.id), dryRun: args.dry_run === true });
}

async function dispatch(service: LineServiceLike, name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const read = callLineReadTool(service, name, args);
  if (read) {
    const answer = await read;
    return withNotes(answer.value, answer.notes);
  }
  switch (name) {
    case 'line_locate_paths':
      return service.locate();
    case 'line_inspect_storage':
      return service.inspect();
    case 'line_get_history':
      return getHistory(service, args, signal);
    case 'line_get_unread':
      return getUnread(service, args, signal);
    case 'line_send':
      return callLineSend(service, args);
    case 'line_react':
      return callLineReact(service, args);
    case 'line_unsend':
      return callLineUnsend(service, args);
    case 'line_download': {
      const answer = await callLineDownload(service, args);
      return withNotes(answer.value, answer.notes);
    }
    case 'line_preview': {
      const answer = await callLinePreview(service, args);
      return withNotes(answer.value, answer.notes);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// The shared server reports a thrown error's `name` as the body's `error`. LINE callers read a
// LineError's code there (UNSUPPORTED_PLATFORM, DB_LOCKED…) and 'ERROR' for anything else, so the
// throw is re-raised as a fresh error carrying that name and, like line-cli's
// `{"error","message","candidates"}`, the candidates when there are any; a LineError is never mutated.
function lineToolError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  if (!isLineError(err)) return new ToolError('ERROR', message);
  const candidates = err.candidates ?? [];
  return new ToolError(err.code, message, candidates.length > 0 ? { candidates } : {});
}

export function createLineMcpServer(service: LineServiceLike): ToolServer {
  return createToolServer({
    name: SERVER_NAME,
    tools: LINE_TOOLS,
    dispatch: async (name, args, signal) => {
      try {
        return await dispatch(service, name, args, signal);
      } catch (err) {
        throw lineToolError(err);
      }
    },
  });
}
