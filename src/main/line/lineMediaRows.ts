/**
 * The message rows line_download and line_preview work on, up to the network and file steps:
 * the SQL, "first N from since, else the newest N up to until, always printed oldest first", the
 * statuses a row gets without a fetch (expired, no_oid, unsupported, server_only, not_cached), and
 * the refusal of an id with nothing to download. The SQL lives here rather than in reader.ts; the
 * reader lends its guarded query and name tables through `mediaSource()`.
 */
import { LineError } from './errors';
import { plainKindSql, type HasColumn } from './lineSearchSql';
import { CONTENT_TYPE, contentTypeName, saneLimit, tsToIso } from './schema';

/** What the media queries borrow from a LineReader (see LineReader.mediaSource). */
export interface MediaSource {
  all(sql: string, params?: unknown[]): Record<string, unknown>[];
  hasColumn: HasColumn;
  chatName(chatId: string): string;
  contacts: ReadonlyMap<string, string>;
  ownMids: ReadonlySet<string>;
  resolveChatId(arg: string): string;
}

export const DEFAULT_DOWNLOAD_LIMIT = 200;
export const DEFAULT_PREVIEW_LIMIT = 50;

/**
 * Why open-chat (Square) media can never be recovered: those rows carry no keyMaterial and no
 * SID/OID, and their cached thumbnails are encrypted with a client-wide key, not a per-message one.
 */
export const OPEN_CHAT_MEDIA_NOTE =
  'open-chat media: LINE stores no per-message key or server object id for it on this PC, so this tool cannot recover it; view it in LINE';

export type DownloadStatus = 'downloaded' | 'expired' | 'http_error' | 'decrypt_failed' | 'no_oid' | 'unsupported' | 'write_failed';
export type PreviewStatus = 'saved' | 'not_cached' | 'server_only' | 'unsupported' | 'write_failed';

/** A download result, keys in line-cli's order; optional keys are left out when empty. */
export interface DownloadResult {
  id: string;
  chat_id: string;
  chat_name: string;
  type: string;
  sender: string;
  sender_id?: string;
  filename?: string;
  sent_at?: string;
  from_me?: boolean;
  status: DownloadStatus;
  saved_as?: string;
  bytes?: number;
  note?: string;
}

/** A preview result, keys in line-cli's order; optional keys are left out when empty. */
export interface PreviewResult {
  id: string;
  chat_id: string;
  chat_name: string;
  type: string;
  sender: string;
  sender_id?: string;
  sent_at?: string;
  from_me?: boolean;
  status: PreviewStatus;
  saved_as?: string;
  bytes?: number;
  note?: string;
}

export interface DownloadQuery {
  chat: string;
  id: string;
  sinceTs: number;
  untilTs: number;
  limit: number;
  media: boolean;
}

export interface PreviewQuery {
  chat: string;
  sinceTs: number;
  untilTs: number;
  limit: number;
}

/** One download row; `sid` is '' when the row already has its final status. */
export interface DownloadJob {
  res: DownloadResult;
  sid: string;
  oid: string;
  keyMaterial: string;
}

/** One preview row; `pending` while it still needs its cached thumbnail read (status not final yet). */
export interface PreviewJob {
  res: PreviewResult;
  pending: boolean;
  ct: number;
  keyMaterial: string;
  thumbPath: string;
}

const OPTIONAL_KEYS = ['sender_id', 'filename', 'sent_at', 'from_me', 'saved_as', 'bytes', 'note'] as const;

/** Drops the optional keys that are empty (Go's omitempty: '', 0, false), keeping the others' order. */
export function omitEmpty<T extends DownloadResult | PreviewResult>(row: T): T {
  const rec = row as unknown as Record<string, unknown>;
  for (const key of OPTIONAL_KEYS) {
    const v = rec[key];
    if (v === undefined || v === '' || v === 0 || v === false) delete rec[key];
  }
  return row;
}

function invalid(message: string): LineError {
  return new LineError('INVALID_ARGUMENT', message);
}

function text(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

function int(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function parseMeta(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function metaString(meta: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = meta[key];
    if (typeof v === 'string' && v) return v;
  }
  return '';
}

// A JSON number (truncated) or a base-10 integer string.
function metaNumber(meta: Record<string, unknown>, key: string): number | null {
  const v = meta[key];
  if (typeof v === 'number') return Math.trunc(v);
  if (typeof v === 'string' && /^[+-]?\d+$/.test(v)) return Number(v);
  return null;
}

// _toType 4 is an open chat, 7 one of its threads.
function isOpenChatMessage(toType: number): boolean {
  return toType === 4 || toType === 7;
}

// The sender as read shows it: a contact or member name, else the name LINE stored on the row, else the id.
function displaySender(src: MediaSource, from: string, contentInfo: Record<string, unknown>): string {
  const known = src.contacts.get(from);
  if (known && known !== from) return known;
  return metaString(contentInfo, 'fromName') || from;
}

function sentAtOf(ms: number): string {
  return ms === 0 ? '' : (tsToIso(ms) ?? '');
}

// A missing column reads as NULL, so an older schema or a minimal fixture still lists its rows.
function columns(has: HasColumn, names: readonly string[]): string {
  return names.map((name) => (has(name) ? name : `NULL AS ${name}`)).join(',');
}

// Like read: the first `limit` from since when given, otherwise the newest `limit` up to until.
function rangeClause(where: string[], params: unknown[], sinceTs: number, untilTs: number): boolean {
  if (sinceTs !== 0) {
    where.push('_createdTime>=?');
    params.push(sinceTs * 1000);
  }
  if (untilTs !== 0) {
    where.push('_createdTime<=?');
    params.push(untilTs * 1000 + 999);
  }
  return sinceTs === 0;
}

/** An id with nothing to download (unsent, an event, or not a file/image/video/voice message) is INVALID_ARGUMENT. */
export function refuseNothingToDownload(id: string, ct: number, type: number, attribute: number): void {
  let kind = contentTypeName(ct);
  if (attribute === 1) {
    throw invalid(`message ${id} was unsent (type unsent, original_type ${kind}); there is nothing to download`);
  }
  if (type === 3 || ct === 18) kind = 'event';
  else if (ct === 1 || ct === 2 || ct === 3 || ct === 14) return;
  throw invalid(`message ${id} is not a file, image, video or voice message (type ${kind})`);
}

const DOWNLOAD_COLUMNS = ['_id', '_chatId', '_from', '_toType', '_contentType', '_contentInfo', '_contentMetadata', '_createdTime', '_type', '_attribute'];

/** The rows of one download run, oldest first, with the statuses known before any fetch. */
export function downloadJobs(src: MediaSource, q: DownloadQuery, nowMs: number): DownloadJob[] {
  let where = [`_contentType IN (${q.media ? '1,2,3,14' : '14'})`];
  const params: unknown[] = [];
  let newest = false;
  if (q.id) {
    where = ['_id=?'];
    params.push(q.id);
  } else {
    if (!q.chat) throw invalid('line_download requires a chat or id');
    params.push(src.resolveChatId(q.chat));
    where.push('_chatId=?', plainKindSql(src.hasColumn));
    newest = rangeClause(where, params, q.sinceTs, q.untilTs);
  }
  const rows = src.all(
    `SELECT ${columns(src.hasColumn, DOWNLOAD_COLUMNS)} FROM _message WHERE ${where.join(' AND ')} ORDER BY _createdTime ${newest ? 'DESC' : 'ASC'} LIMIT ?`,
    [...params, saneLimit(q.limit, DEFAULT_DOWNLOAD_LIMIT)],
  );
  const jobs: DownloadJob[] = [];
  for (const row of rows) {
    const ct = int(row._contentType);
    if (q.id) refuseNothingToDownload(q.id, ct, int(row._type), int(row._attribute));
    const from = text(row._from);
    const chatId = text(row._chatId);
    const ci = parseMeta(text(row._contentInfo));
    const meta = parseMeta(text(row._contentMetadata));
    const res: DownloadResult = {
      id: text(row._id),
      chat_id: chatId,
      chat_name: src.chatName(chatId),
      type: CONTENT_TYPE[ct] ?? 'type',
      sender: displaySender(src, from, ci),
      sender_id: from,
      filename: metaString(ci, 'fileName') || metaString(meta, 'FILE_NAME', 'fileName'),
      sent_at: sentAtOf(int(row._createdTime)),
      from_me: from !== '' && src.ownMids.has(from),
      status: 'downloaded',
      saved_as: '',
      bytes: 0,
      note: '',
    };
    const expires = metaNumber(meta, 'FILE_EXPIRE_TIMESTAMP');
    if (expires !== null && nowMs > expires) {
      jobs.push({ res: { ...res, status: 'expired', note: 'LINE deleted the file from its server (expired)' }, sid: '', oid: '', keyMaterial: '' });
      continue;
    }
    const sid = metaString(meta, 'SID');
    const oid = metaString(meta, 'OID');
    const keyMaterial = metaString(ci, 'keyMaterial');
    if (!sid || !oid || !keyMaterial) {
      const open = isOpenChatMessage(int(row._toType));
      res.status = open ? 'unsupported' : 'no_oid';
      res.note = open ? OPEN_CHAT_MEDIA_NOTE : 'message has no server object id or key';
      jobs.push({ res, sid: '', oid: '', keyMaterial: '' });
      continue;
    }
    jobs.push({ res, sid, oid, keyMaterial });
  }
  if (q.id && jobs.length === 0) throw invalid(`no message with id: ${q.id}`);
  if (newest) jobs.reverse();
  return jobs;
}

const PREVIEW_COLUMNS = ['_id', '_from', '_toType', '_contentType', '_contentInfo', '_createdTime'];

// The status a preview row gets without touching the cache; null when its thumbnail must be read.
function offlinePreviewStatus(toType: number, ct: number, keyMaterial: string, thumbPath: string): { status: PreviewStatus; note: string } | null {
  if (isOpenChatMessage(toType)) return { status: 'unsupported', note: OPEN_CHAT_MEDIA_NOTE };
  if (ct === 14) return { status: 'server_only', note: "file is not cached locally; only on LINE's server" };
  if (!thumbPath || !keyMaterial) return { status: 'not_cached', note: 'no cached thumbnail on this PC' };
  return null;
}

/** The media rows of one chat for preview, oldest first; statuses known offline filled in, the rest pending. */
export function previewJobs(src: MediaSource, q: PreviewQuery): PreviewJob[] {
  const chatId = src.resolveChatId(q.chat);
  const where = ['_chatId=?', '_contentType IN (1,2,14)', plainKindSql(src.hasColumn)];
  const params: unknown[] = [chatId];
  const newest = rangeClause(where, params, q.sinceTs, q.untilTs);
  const rows = src.all(
    `SELECT ${columns(src.hasColumn, PREVIEW_COLUMNS)} FROM _message WHERE ${where.join(' AND ')} ORDER BY _createdTime ${newest ? 'DESC' : 'ASC'} LIMIT ?`,
    [...params, saneLimit(q.limit, DEFAULT_PREVIEW_LIMIT)],
  );
  const chatName = src.chatName(chatId);
  const jobs = rows.map((row): PreviewJob => {
    const from = text(row._from);
    const ci = parseMeta(text(row._contentInfo));
    const ct = int(row._contentType);
    const keyMaterial = metaString(ci, 'keyMaterial');
    const thumbPath = metaString(ci, 'thumbPath');
    const offline = offlinePreviewStatus(int(row._toType), ct, keyMaterial, thumbPath);
    const res: PreviewResult = {
      id: text(row._id),
      chat_id: chatId,
      chat_name: chatName,
      type: CONTENT_TYPE[ct] ?? 'type',
      sender: displaySender(src, from, ci),
      sender_id: from,
      sent_at: sentAtOf(int(row._createdTime)),
      from_me: from !== '' && src.ownMids.has(from),
      status: offline?.status ?? 'saved',
      saved_as: '',
      bytes: 0,
      note: offline?.note ?? '',
    };
    return { res, pending: offline === null, ct, keyMaterial, thumbPath };
  });
  if (newest) jobs.reverse();
  return jobs;
}
