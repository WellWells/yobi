/**
 * Sending files, photos and videos as the user.
 *
 * Each file is its own message, in order, the way LINE for PC sends them. TypeScript decides what is
 * sent (checks, previews, album grouping, duplicate guard, verification); the native core encrypts,
 * uploads and posts each file (nativeSendFile). A file the core did not send (not_sent) does not stop
 * the rest; any other failure does. Once anything was sent, every error goes into the plan (what was
 * sent, what failed, what was not tried), so a caller never sends a file twice.
 */
import { randomBytes } from 'node:crypto';
import { LineError, isLineError } from './errors';
import { checkFileTypes } from './lineFileTypes';
import { claimSend, findSent, freshReader, nativeOutcomeError, sendText, verifySent, VERIFY_SKEW_MS, type SendDeps, type SentMatch } from './lineSend';
import type { FileSend, PreparedFile } from './lineSendFilePrep';
import { appendSendLog, outcome, recentDuplicate, type SendLogEntry } from './lineSendLog';
import { buildNativeFileRequest } from './lineSendNative';
import { replyTarget, type ReplyTarget } from './lineSendReply';
import { CONTENT_FILE, CONTENT_IMAGE, readySendKeys, resolveSendTarget, type SendPlan } from './lineSendText';
import { newClientMessageID } from './lineClientId';
import type { NativeSendResult } from './nativeContract';
import { adaptMessage } from './nativeMessageAdapt';
import type { LineReader } from './reader';
import { tsToIso } from './schema';

/** The native core (SendDeps.nativeSendFile) uploads and posts, so a file send needs nothing more. */
export type SendFilesDeps = SendDeps;

export interface SendFilesOptions {
  /** From prepareFiles, which checks them before LINE is touched. */
  files: PreparedFile[];
  dryRun: boolean;
  allowDuplicate?: boolean;
  /** Sent as a message before the files when not empty (raw: sendText normalizes it). */
  text?: string;
  /** Quotes this stored message in the first message sent. */
  replyTo?: string;
  /**
   * The photos of this send go as one album, the way LINE for PC sends several picked together:
   * two or more share a group id, each with its place and the count (videos and files never join).
   * line-cli has no album.
   */
  album?: boolean;
  notify?: (note: string) => void;
  random?: (len: number) => Buffer;
}

/**
 * LINE's message ids count 10 ms steps since this moment (2014-10-09T05:08:23.020Z) above their low
 * 24 bits, which tell apart ids of the same step; every stored id measured fits within a second.
 */
const LINE_ID_EPOCH_MS = 1_412_831_303_020;

/**
 * A new album's group id. Measured on stored albums, a GID is shaped like LINE's message ids and
 * within tens of milliseconds of its first photo's: the 10 ms step since LINE's epoch, then 24
 * random bits.
 */
export function newAlbumId(nowMs: number, random: (len: number) => Buffer): string {
  const step = BigInt(Math.max(0, Math.floor((nowMs - LINE_ID_EPOCH_MS) / 10)));
  return ((step << 24n) | BigInt(random(3).readUIntBE(0, 3))).toString();
}

/** What a file send did or (dry run) would do; keys in line-cli's order. Never key material or the token. */
export interface SendFilesPlan {
  to: string;
  to_name: string;
  chat_type: string;
  from: string;
  /** The text sent before the files. */
  text_message?: SendPlan;
  reply_to?: ReplyTarget;
  files: FileSend[];
  sender_key_id: number;
  receiver_key_id: number;
  e2ee_version: number;
  dry_run: boolean;
  sent_count: number;
  /** Set when the send stopped at a failed file; the files before it were sent. */
  error?: string;
  message?: string;
}

// A file's entry in line-cli's field order, leaving out the empty optional fields as Go's omitempty does.
function fileJson(f: FileSend): FileSend {
  return {
    path: f.path,
    name: f.name,
    kind: f.kind,
    bytes: f.bytes,
    sha256: f.sha256,
    ...(f.duration_ms ? { duration_ms: f.duration_ms } : {}),
    ...(f.gps_removed ? { gps_removed: true } : {}),
    ...(f.width ? { width: f.width } : {}),
    ...(f.height ? { height: f.height } : {}),
    status: f.status,
    ...(f.verified ? { verified: true } : {}),
    ...(f.server_message_id ? { server_message_id: f.server_message_id } : {}),
    ...(f.sent_at ? { sent_at: f.sent_at } : {}),
    ...(f.expires_at ? { expires_at: f.expires_at } : {}),
    ...(f.error ? { error: f.error } : {}),
  };
}

function planJson(p: SendFilesPlan): SendFilesPlan {
  return {
    to: p.to,
    to_name: p.to_name,
    chat_type: p.chat_type,
    from: p.from,
    ...(p.text_message ? { text_message: p.text_message } : {}),
    ...(p.reply_to ? { reply_to: p.reply_to } : {}),
    files: p.files.map(fileJson),
    sender_key_id: p.sender_key_id,
    receiver_key_id: p.receiver_key_id,
    e2ee_version: p.e2ee_version,
    dry_run: p.dry_run,
    sent_count: p.sent_count,
    ...(p.error ? { error: p.error } : {}),
    ...(p.message ? { message: p.message } : {}),
  };
}

function errorParts(err: unknown): { code: string; message: string } {
  if (isLineError(err)) return { code: err.code, message: err.message };
  return { code: 'SEND_FAILED', message: err instanceof Error ? err.message : String(err) };
}

/**
 * Sends each prepared file to a one-to-one chat or group as its own message (with dryRun, returns
 * the plan without sending). With `text`, that goes first; `replyTo` quotes a message in the first
 * message sent; `album` makes the photos one album. Notes line-cli prints on stderr go to opts.notify.
 */
export async function sendFiles(reader: LineReader, to: string, opts: SendFilesOptions, deps: SendFilesDeps): Promise<SendFilesPlan> {
  const notify = opts.notify ?? (() => undefined);
  const random = opts.random ?? randomBytes;
  const jobs = opts.files;
  if (jobs.length === 0) throw new LineError('INVALID_ARGUMENT', 'no files to send');
  const { chatId, toName, chatType, from, contactWarning } = resolveSendTarget(reader, to);
  if (contactWarning) notify(`note: ${contactWarning}`);
  let replyTo = opts.replyTo ?? '';
  // A fresh read: the shared handle sees the database as of when it opened, and the message to
  // quote may have come since.
  const reply = replyTo ? replyTarget(freshReader(deps) ?? reader, chatId, replyTo) : undefined;
  checkFileTypes(reader.serverSettings(), jobs.map((j) => j.file.name), notify);
  // Check the key state now so a missing key fails before any upload; files and photos always
  // seal with Letter Sealing v2 (in the native core).
  const { keys } = await readySendKeys(reader, chatId, deps.nativeKeys);
  const plan: SendFilesPlan = {
    to: chatId,
    to_name: toName,
    chat_type: chatType,
    from,
    ...(reply ? { reply_to: reply } : {}),
    files: [],
    sender_key_id: keys.myKeyId,
    receiver_key_id: keys.recvKeyId,
    e2ee_version: 2,
    dry_run: opts.dryRun,
    sent_count: 0,
  };
  for (const j of jobs) {
    const dup = await recentDuplicate(deps.storeDir, chatId, j.file.sha256, deps.now());
    if (!dup || opts.allowDuplicate) continue;
    if (opts.dryRun) {
      notify(`note: ${j.file.name} went to this chat at ${dup.time} (${outcome(dup)}); a real send will be refused with DUPLICATE_SEND unless allow_duplicate`);
    } else {
      throw new LineError('DUPLICATE_SEND', `the same file (${j.file.name}) was already sent, or possibly sent, to ${dup.to} at ${dup.time} (${outcome(dup)}); check with line_get_history with chat_id ${dup.to} and add allow_duplicate only if you really mean to send it again`);
    }
  }
  if (opts.text) {
    plan.text_message = await sendText(reader, chatId, opts.text, {
      dryRun: opts.dryRun, allowDuplicate: opts.allowDuplicate, ...(replyTo ? { replyTo } : {}), notify,
    }, deps);
    delete plan.reply_to;
    replyTo = '';
  }
  if (opts.dryRun) {
    plan.files = jobs.map((j) => ({ ...j.file, status: 'planned' }));
    return planJson(plan);
  }

  // From here on, once anything was sent every error goes into the plan: a caller that retries on
  // an error must never send twice. With several files the plan also says which failed and which
  // were not tried.
  const stop = (next: number, err: unknown): SendFilesPlan => {
    if (plan.sent_count === 0 && !plan.text_message && jobs.length === 1) throw err;
    const { code, message } = errorParts(err);
    plan.error = code;
    plan.message = message;
    for (const rest of jobs.slice(next)) plan.files.push({ ...rest.file, status: 'not_sent' });
    return planJson(plan);
  };

  let tokens: string[];
  try {
    tokens = await deps.tokens();
  } catch (err) {
    return stop(0, err);
  }
  const own = new Set([from, ...reader.ownIds()]);
  // Counted after prepareFiles: only what goes as a photo joins (a large PNG goes as a file).
  const photos = opts.album ? jobs.filter((j) => j.contentType === CONTENT_IMAGE) : [];
  const albumId = photos.length > 1 ? newAlbumId(deps.now(), random) : '';
  // A file the core reports as not sent (nothing uploaded or posted) does not stop the rest; the
  // first such error is reported in the plan.
  let softError: unknown;
  for (const [i, j] of jobs.entries()) {
    const seq = albumId ? photos.indexOf(j) + 1 : 0;
    const album = seq > 0 ? { gid: albumId, seq, total: photos.length } : undefined;
    try {
      plan.files.push(await sendOneFile({ reader, deps, j, chatId, from, relatedId: i === 0 ? replyTo : '', album, own, tokens, allowDuplicate: opts.allowDuplicate === true, notify }));
      plan.sent_count++;
    } catch (err) {
      plan.files.push({ ...j.file, status: 'failed', error: errorParts(err).message });
      if (!isNotSent(err)) return stop(i + 1, err);
      softError ??= err;
    }
  }
  if (softError !== undefined) {
    if (plan.sent_count === 0 && !plan.text_message && jobs.length === 1) throw softError;
    const { code, message } = errorParts(softError);
    plan.error = code;
    plan.message = message;
  }
  return planJson(plan);
}

// Errors of files the core reported as not sent (retryable, nothing went out).
const NOT_SENT = new WeakSet<object>();
function isNotSent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && NOT_SENT.has(err);
}

interface OneFile {
  reader: LineReader;
  deps: SendFilesDeps;
  j: PreparedFile;
  chatId: string;
  from: string;
  relatedId: string;
  album: { gid: string; seq: number; total: number } | undefined;
  own: ReadonlySet<string>;
  tokens: string[];
  allowDuplicate: boolean;
  notify: (note: string) => void;
}

/**
 * Sends one file through the native core (GPS clearing, encryption, upload, seal, POST) and verifies
 * it. The key state is checked and the attempt logged PENDING first; an error before the core
 * answers means nothing was sent.
 */
async function sendOneFile(a: OneFile): Promise<FileSend> {
  const { reader, deps, j, chatId, from, relatedId } = a;
  if (!deps.nativeSendFile) throw new LineError('NATIVE_CORE_UNAVAILABLE', 'LINE native send core is not wired in');
  const id = newClientMessageID();
  const createdTime = deps.now();
  const req = await buildNativeFileRequest(reader, deps.nativeKeys, { chatId, from, job: j, clientId: id, createdTime, relatedId, album: a.album, tokens: a.tokens, clientEnv: deps.clientEnv() });
  const match: SentMatch = { chatId, own: a.own, sinceMs: createdTime - VERIFY_SKEW_MS, serverID: '', text: '', relatedId, oid: '' };
  const before = findSent(freshReader(deps) ?? reader, match);
  const entry = { to: chatId, sha256: j.file.sha256, length: Math.min(j.file.bytes, 2 ** 31 - 1), result: '', client_message_id: id };
  await claimSend(deps, entry, a.allowDuplicate);

  let res: NativeSendResult | undefined;
  let error: LineError | undefined;
  try {
    res = await deps.nativeSendFile(req);
    error = nativeOutcomeError(deps, res);
    if (error && res.outcome === 'not_sent') NOT_SENT.add(error);
  } catch (err) {
    // The loader failed: a missing core or platform means nothing was posted; anything else may have been.
    error = isLineError(err) && (err.code === 'NATIVE_CORE_UNAVAILABLE' || err.code === 'UNSUPPORTED_PLATFORM')
      ? err
      : new LineError('SEND_UNCERTAIN', adaptMessage(`the send outcome is unknown (${errorParts(err).message}); check with line_get_history with chat_id ${chatId} before resending (client message id ${id})`));
  }
  const logged: SendLogEntry = { ...entry, result: 'OK', server_message_id: res?.serverId && res.serverId !== id ? res.serverId : undefined };
  if (error) {
    logged.result = error.code;
    logged.maybe_delivered = res?.outcome === 'server_error';
  }
  try {
    await appendSendLog(deps.storeDir, logged, deps.now());
  } catch (err) {
    a.notify(`note: could not write the send log: ${errorParts(err).message}`);
  }
  if (error || !res) throw error;

  const out: FileSend = { ...j.file, status: 'sent' };
  const serverID = res.serverId && res.serverId !== id ? res.serverId : '';
  if (serverID) out.server_message_id = serverID;
  const sentAt = res.createdTimeMs ?? 0;
  if (sentAt > 0) {
    out.sent_at = tsToIso(sentAt) ?? undefined;
    match.sinceMs = Math.min(match.sinceMs, sentAt - VERIFY_SKEW_MS);
  }
  match.serverID = serverID;
  match.oid = res.oid ?? '';
  out.verified = await verifySent(deps, match, before);
  if (out.verified && j.contentType === CONTENT_FILE) {
    const expires = storedExpire(deps, chatId, res.oid ?? '');
    if (expires > 0) out.expires_at = tsToIso(expires) ?? undefined;
  }
  return out;
}

// A failed read only costs the expiry, never the send.
function storedExpire(deps: SendDeps, chatId: string, oid: string): number {
  try {
    return freshReader(deps)?.storedFileExpire(chatId, oid) ?? 0;
  } catch {
    return 0;
  }
}
