/**
 * The line_download and line_preview tools: their definitions, argument checks and paging notes,
 * matching line-cli's download/preview commands with its flags named as
 * the tools' params. There is no `out`: files always go to Downloads/Yobi (previews in its
 * `previews` folder), never where a model chooses.
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ALSO_NAMED } from '../mcp/schemaAliases';
import { invalid, limitArg, readPageNote, stringArg } from './lineArgs';
import { DEFAULT_DOWNLOAD_LIMIT, DEFAULT_PREVIEW_LIMIT, type DownloadQuery, type PreviewQuery } from './lineMediaRows';
import type { LineServiceLike } from './lineService';
import { parseLineRange } from './lineTimeRange';

const SINCE = "Optional range start: YYYY-MM-DD, YYYYMMDD, 'YYYY-MM-DD HH:MM', RFC3339, unix seconds or milliseconds; this computer's local time unless an offset is given. A sent_at can be passed back as it is.";
const UNTIL = 'Optional range end (same formats; a bare date includes that whole day)';
// The other LINE tools call it chat_id, and the errors say "a chat_id or name": take that name too.
const CHAT_NAMES = { [ALSO_NAMED]: ['chat_id'] };
const PRIVATE = 'These are the user\'s private decrypted files: never copy them into git repositories or shared places. Yobi deletes what it saved in Downloads/Yobi after the period set for downloads (three days unless changed).';

export const LINE_MEDIA_TOOLS: Tool[] = [
  {
    name: 'line_download',
    description:
      "Download LINE files from LINE's server into Downloads/Yobi (media: true adds full-size images, videos and voice messages). The files are decrypted; saved_as is the absolute path. Online: LINE for Windows must be running and signed in. Give chat to get its files: without since, the newest `limit` (up to until); with since, the first `limit` from it. Output is oldest first, so page older with until = the first sent_at. media: true also gets full-resolution images, videos and voice messages. Or give id to get exactly that one file, image, video or voice message (an unsent message, an event or any other type is INVALID_ARGUMENT); chat, range and media are then ignored. Message ids come from line_search_messages, line_read_around, line_find_file and line_preview, or from line_get_history and line_get_unread with ids: true. Each row has a status: downloaded | expired | http_error | decrypt_failed | no_oid | unsupported | write_failed, and a note saying why when it was not downloaded. LINE deletes files from its server about 7 days after they were sent (status expired). Open-chat media cannot be downloaded (status unsupported). File names are made safe for Windows; the same message always saves under the same name. " +
      `${PRIVATE} If a note says Windows blocked the connection, tell the user; do not retry. Photos someone sent: line_search_messages with type image (and from, chat or since), then line_download with each id. Windows only.`,
    inputSchema: {
      type: 'object',
      properties: {
        chat: { type: 'string', description: 'Chat id or name (not needed with id)', ...CHAT_NAMES },
        id: { type: 'string', description: 'One message id, from any chat: download exactly that message\'s file, image, video or voice message', [ALSO_NAMED]: ['message_id'] },
        since: { type: 'string', description: SINCE },
        until: { type: 'string', description: UNTIL },
        limit: { type: 'number', description: `Max messages (default ${DEFAULT_DOWNLOAD_LIMIT}, max 5000)` },
        media: { type: 'boolean', description: 'Also download full-resolution images, videos and voice messages, not only files (default false)' },
      },
    },
  },
  {
    name: 'line_preview',
    description:
      "Save a LINE chat's cached image and video thumbnails into Downloads/Yobi/previews; offline, thumbnail quality only. The files are decrypted; saved_as is the absolute path. Instant: only this PC's LINE cache is read, never LINE's server. Like line_get_history: without since, the newest `limit` media (up to until); with since, the first `limit` from it. Output is oldest first, so page older with until = the first sent_at. Each row has a status: saved | not_cached | server_only | unsupported | write_failed, with a note when it was not saved (a saved video is only its poster frame). Shared files and full-resolution originals are only on LINE's server (status server_only): line_download with the row's id gets them (LINE running; files expire about 7 days after they were sent). Open-chat media cannot be recovered (status unsupported). " +
      `${PRIVATE} A chat's recent images, offline: line_preview with chat and since. Windows only.`,
    inputSchema: {
      type: 'object',
      properties: {
        chat: { type: 'string', description: 'Chat id or name', ...CHAT_NAMES },
        since: { type: 'string', description: SINCE },
        until: { type: 'string', description: UNTIL },
        limit: { type: 'number', description: `Max media messages (default ${DEFAULT_PREVIEW_LIMIT}, max 5000)` },
      },
      required: ['chat'],
    },
  },
];

function messageIdArg(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw invalid('id must be a string: pass the message id exactly as the LINE tools return it');
  return value;
}

export interface ToolAnswer {
  value: unknown;
  notes: string[];
}

/** line_download: validates like line-cli's download command, then runs; one id has no paging note. */
export async function callLineDownload(service: LineServiceLike, args: Record<string, unknown>): Promise<ToolAnswer> {
  const chat = stringArg(args.chat).trim();
  const id = messageIdArg(args.id);
  if (!chat && !id) throw invalid('line_download requires a chat_id or name, or id');
  const limit = limitArg(args.limit);
  const { sinceTs, untilTs } = parseLineRange(stringArg(args.since), stringArg(args.until));
  const media = args.media === true || args.media === 'true';
  const q: DownloadQuery = { chat, id, sinceTs, untilTs, limit, media };
  const rows = await service.download(q);
  return { value: rows, notes: id ? [] : readPageNote(rows, limit, DEFAULT_DOWNLOAD_LIMIT, sinceTs) };
}

/** line_preview: validates like line-cli's preview command, then runs. */
export async function callLinePreview(service: LineServiceLike, args: Record<string, unknown>): Promise<ToolAnswer> {
  const chat = stringArg(args.chat).trim();
  if (!chat) throw invalid('line_preview requires a chat_id or name');
  const limit = limitArg(args.limit);
  const { sinceTs, untilTs } = parseLineRange(stringArg(args.since), stringArg(args.until));
  const q: PreviewQuery = { chat, sinceTs, untilTs, limit };
  const rows = await service.preview(q);
  return { value: rows, notes: readPageNote(rows, limit, DEFAULT_PREVIEW_LIMIT, sinceTs) };
}
