/**
 * Which pictures or files a "Yobi" line on LINE PC is about, read from LINE's own database when
 * the line comes in: the message it quotes (LINE's Reply) when that is a photo, a video, a voice
 * message or a file; with no quote, the same sender's own message just before it in that chat,
 * when that is a photo or a file sent at most two minutes earlier (a photo, then "Yobi 這是什麼").
 * A photo of an album brings the album (the rows of its GID, at most ten, that photo among them).
 * Nothing else of the chat is read: only the quoted message, or rows by the person asking.
 */
import { downloadedPath } from '../line/lineLocalFile';
import { metaNumber, metaString, parseMeta } from '../line/lineMessageParts';
import { targetMessage } from '../line/lineSendReply';
import type { LineReader } from '../line/reader';
import type { ParsedMessage } from '../line/schema';

/** How long after a photo or file its sender's "Yobi" line still means it. */
export const LINE_SELF_MEDIA_WINDOW_MS = 2 * 60_000;
/** The most photos of one album handed to a run (as Telegram takes). */
export const LINE_SELF_ALBUM_MAX = 10;
const MESSAGE_TABLE = '_message';
/** Rows of the sender's read to find an album's photos; the GID filter narrows them first. */
const ALBUM_ROWS = 50;

export type LineSelfMediaKind = 'image' | 'video' | 'audio' | 'file';

const MEDIA_KINDS: ReadonlySet<string> = new Set<LineSelfMediaKind>(['image', 'video', 'audio', 'file']);
/** What the message just before counts as: a photo or a file, never a voice message or a video. */
const PREVIOUS_KINDS: ReadonlySet<string> = new Set<LineSelfMediaKind>(['image', 'file']);

/** One picture or file, as the chat says it is: what the plan is made from, before anything is fetched. */
export interface LineSelfMediaRow {
  id: string;
  kind: LineSelfMediaKind;
  fileName?: string;
  sizeBytes?: number;
  /** A copy the user saved on this computer (LINE recorded where, and it is still that size). */
  localPath?: string;
}

/** The media a request is about, and whose message it is. */
export interface LineSelfMediaRef {
  rows: LineSelfMediaRow[];
  /** Who sent it. */
  senderId: string;
  /** Their name as the chat shows it; '' when unknown. */
  senderName: string;
  /** The words sent with it (a file's caption), '' for none. */
  text: string;
  /** Quoted with LINE's Reply (else the sender's own message just before the request). */
  quoted: boolean;
}

export interface LineSelfMediaRequest {
  chatId: string;
  /** Who asked. */
  userId: string;
  /** The "Yobi" line's own id. */
  messageId: string;
  /** When LINE stored it (ms). */
  sentAt: number;
  /** The message it quotes, when it does. */
  replyToId?: string;
  /** Whether a message is one the bot sent (its pictures come back as the user's own rows). */
  sentByBot?: (id: string) => boolean;
}

function mediaRow(message: ParsedMessage, row: Record<string, unknown> | undefined): LineSelfMediaRow | null {
  if (!message.id || !MEDIA_KINDS.has(message.type)) return null;
  const kind = message.type as LineSelfMediaKind;
  const out: LineSelfMediaRow = { id: message.id, kind };
  if (message.filename) out.fileName = message.filename;
  if (typeof message.file_size === 'number') out.sizeBytes = message.file_size;
  if (kind === 'file' && row) {
    const info = parseMeta(String(row._contentInfo ?? ''));
    const recorded = metaNumber(info, 'downloadedFileSize');
    const saved = downloadedPath(metaString(info, 'downloadedPath'), recorded, message.file_size ?? null);
    if (saved) {
      out.localPath = saved;
      // The saved copy is that size (`downloadedPath` checked it), so the plan can refuse a big one.
      if (out.sizeBytes === undefined && recorded !== null) out.sizeBytes = recorded;
    }
  }
  return out;
}

function storedRow(reader: LineReader, chatId: string, id: string): Record<string, unknown> | undefined {
  return reader.access().get(`SELECT * FROM ${MESSAGE_TABLE} WHERE _id = ? AND _chatId = ?`, [id, chatId]);
}

/**
 * At most `LINE_SELF_ALBUM_MAX` of an album's photos, always with the one the request is about:
 * the first ten, or the ten that end at it when it comes later.
 */
function albumWindow(photos: readonly LineSelfMediaRow[], about: LineSelfMediaRow): LineSelfMediaRow[] {
  const at = photos.findIndex((photo) => photo.id === about.id);
  if (at < 0) return [...photos.slice(0, LINE_SELF_ALBUM_MAX - 1), about];
  const start = Math.max(0, at - (LINE_SELF_ALBUM_MAX - 1));
  return photos.slice(start, start + LINE_SELF_ALBUM_MAX);
}

/** The photos of the album `first` belongs to, by the same sender in the same chat, in their order. */
function albumRows(reader: LineReader, chatId: string, first: ParsedMessage, firstRow: LineSelfMediaRow): LineSelfMediaRow[] {
  const gid = first.album?.id ?? '';
  const senderId = first.sender_id ?? '';
  if (!/^[0-9]+$/.test(gid) || !senderId) return [firstRow];
  const access = reader.access();
  const parse = access.parser();
  const rows = access.all(
    `SELECT * FROM ${MESSAGE_TABLE} WHERE _chatId = ? AND _from = ? AND _contentType = 1 AND _contentMetadata LIKE ? ORDER BY _createdTime ASC LIMIT ?`,
    [chatId, senderId, `%${gid}%`, ALBUM_ROWS],
  );
  const photos = rows
    .map((row) => parse(row))
    .filter((message) => message.type === 'image' && message.album?.id === gid && message.id)
    .sort((a, b) => (a.album?.index ?? 0) - (b.album?.index ?? 0))
    .flatMap((message) => mediaRow(message, undefined) ?? []);
  return photos.length > 0 ? albumWindow(photos, firstRow) : [firstRow];
}

function refOf(reader: LineReader, chatId: string, message: ParsedMessage, quoted: boolean): LineSelfMediaRef | null {
  const id = message.id ?? '';
  const row = mediaRow(message, storedRow(reader, chatId, id));
  if (!row) return null;
  const name = message.sender && message.sender !== message.sender_id ? message.sender : '';
  return {
    rows: row.kind === 'image' && message.album ? albumRows(reader, chatId, message, row) : [row],
    senderId: message.sender_id ?? '',
    senderName: name,
    text: row.kind === 'file' ? (message.content ?? '').trim() : '',
    quoted,
  };
}

/** The quoted message's media; null when it quotes none (or quotes nothing of this chat). */
function quotedMedia(reader: LineReader, req: LineSelfMediaRequest): LineSelfMediaRef | null {
  if (!req.replyToId) return null;
  let message: ParsedMessage;
  try {
    message = targetMessage(reader, req.chatId, req.replyToId, 'reply_to', 'replied to').message;
  } catch {
    return null;
  }
  return refOf(reader, req.chatId, message, true);
}

/** The asker's own message just before the request, when it is a photo or a file of the last two minutes. */
function previousMedia(reader: LineReader, req: LineSelfMediaRequest): LineSelfMediaRef | null {
  const access = reader.access();
  const row = access.get(
    // Rows of the same millisecond in the order LINE numbered them (ids grow; compared as numbers).
    `SELECT * FROM ${MESSAGE_TABLE} WHERE _chatId = ? AND _from = ? AND _id <> ? AND _createdTime <= ? ORDER BY _createdTime DESC, length(_id) DESC, _id DESC LIMIT 1`,
    [req.chatId, req.userId, req.messageId, req.sentAt],
  );
  if (!row) return null;
  const at = Number(row._createdTime) || 0;
  if (req.sentAt - at > LINE_SELF_MEDIA_WINDOW_MS) return null;
  const message = access.parser()(row);
  if (!PREVIOUS_KINDS.has(message.type) || message.undecryptable) return null;
  // The picture Yobi just sent the user is no photo of theirs; quoted, it is ("Yobi 改成藍色").
  if (message.id && req.sentByBot?.(message.id)) return null;
  return refOf(reader, req.chatId, message, false);
}

/** What the request is about: the quoted message's media, else the asker's photo or file just before; null for none. */
export function requestMedia(reader: LineReader, req: LineSelfMediaRequest): LineSelfMediaRef | null {
  if (req.replyToId) return quotedMedia(reader, req);
  return previousMedia(reader, req);
}
