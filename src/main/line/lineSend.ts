/**
 * Sending a LINE message. After the POST this only
 * returns SEND_FAILED or SEND_UNCERTAIN, so a caller that retries on a DB error never sends twice.
 * sent:true (even with verified:false) is a successful send — never resend it.
 *
 * The network, token source, clock and store dir are injected, so the orchestration (duplicate
 * guard, token iteration, reply classification, verification) is testable; the live POST to LINE
 * is exercised on the device.
 */
import { LineError } from './errors';
import { checkReplyId } from './lineSendReply';
import { nativeTextDryRun, nativeTextSend, type NativeFileSender, type NativeSender } from './lineSendNative';
import type { NativeClientEnv, NativeSendResult } from './nativeContract';
import { adaptMessage } from './nativeMessageAdapt';
import { normalizeSendText, prepareSend, type NativeKeyPicker, type PreparedSend, type SendPlan } from './lineSendText';
import { appendSendLog, duplicateMessage, duplicateNote, recentDuplicate, RESULT_PENDING, type SendLogEntry } from './lineSendLog';
import type { LineReader } from './reader';
import { tsToIso } from './schema';


export interface SendDeps {
  /** Access-token candidates from LINE's memory, most-frequent first. */
  tokens: () => Promise<string[]>;
  now: () => number;
  /** Where the send log lives (a per-user folder, never a backup category). */
  storeDir: string;
  /** Where the native core finds LINE's client version and locale for the request headers. */
  clientEnv: () => NativeClientEnv;
  /** A fresh reader to confirm the sent row appeared (sees the WAL as of open); optional. */
  verifyReader?: () => LineReader | null;
  /** The program a firewall must allow, named when Windows blocks the connection. */
  programPath?: string;
  /** Picks the keys to seal with in the native core. */
  nativeKeys?: NativeKeyPicker;
  /** Computes a text dry-run's sealing vectors in the native core; absent = the dry run uses `nativeSend`. */
  nativeDryRun?: NativeSender;
  /** Performs the real text send (POST, token iteration, reply classification) in the native core. */
  nativeSend?: NativeSender;
  /** Performs one file send (E2EE, upload, seal, POST) in the native core. */
  nativeSendFile?: NativeFileSender;
}

export interface SendOptions {
  dryRun: boolean;
  allowDuplicate?: boolean;
  /** The id of a stored message of the same chat to reply to (line-cli's --reply-to). */
  replyTo?: string;
  /** People to tag in a group: a member id, a member's exact name, or <word>=<id>. */
  mention?: readonly string[];
  mentionAll?: boolean;
  /** Receives the notes line-cli prints on stderr (each starting `note:` or `warning:`). */
  notify?: (note: string) => void;
}

export const VERIFY_SKEW_MS = 60_000;
const MAX_INPUT_BYTES = 1 << 20;

// Serialises claimSend across concurrent sends in this process (a single app instance).
let claimChain: Promise<void> = Promise.resolve();

export async function underClaimLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = claimChain.then(fn, fn);
  claimChain = run.then(() => undefined, () => undefined);
  return run;
}


function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}


/** What to do when Windows refused the connection: firewall rules follow the program's path. */
export function firewallHint(program = process.execPath): string {
  return `Windows blocked the connection before it was made: a firewall or security program (such as Bitdefender or Windows Defender Firewall) does not allow ${program} (the program Yobi runs as) to connect. Allow that program in the firewall (rules follow the program's path), then retry; this is not a LINE sign-in problem`;
}

// Re-checks the duplicate guard and logs the attempt as PENDING under the lock, so a concurrent
// identical send is refused, and so is a later one if this process dies before LINE answers. On
// error nothing has been sent.
export async function claimSend(deps: SendDeps, entry: SendLogEntry, allowDuplicate: boolean): Promise<void> {
  await underClaimLock(async () => {
    if (!allowDuplicate) {
      const dup = await recentDuplicate(deps.storeDir, entry.to, entry.sha256, deps.now());
      if (dup) throw new LineError('DUPLICATE_SEND', duplicateMessage(dup));
    }
    try {
      await appendSendLog(deps.storeDir, { ...entry, result: RESULT_PENDING, time: '' }, deps.now());
    } catch (err) {
      throw new LineError('SEND_FAILED', `not sent: could not write the send log: ${errorMessage(err)}`);
    }
  });
}

/**
 * The row LINE writes for a message we sent (see LineReader.findSentMessageIds): its server id, or
 * when that is unknown a file's object id (`oid`), or else the exact text.
 */
export interface SentMatch {
  chatId: string;
  own: ReadonlySet<string>;
  sinceMs: number;
  serverID: string;
  text: string;
  relatedId: string;
  oid?: string;
}

// A failed read only costs the confirmation, never the send.
export function findSent(reader: LineReader | null | undefined, m: SentMatch): Set<string> {
  if (!reader) return new Set();
  try {
    return reader.findSentMessageIds(m.chatId, m.sinceMs, m.own, m.serverID, m.text, m.relatedId, m.oid ?? '');
  } catch {
    return new Set();
  }
}

export function freshReader(deps: SendDeps): LineReader | null {
  try {
    return deps.verifyReader?.() ?? null;
  } catch {
    return null;
  }
}

export const VERIFY_WAIT_MS = 12_000;
export const VERIFY_STEP_MS = 500;

// Polls fresh reads (each sees the WAL as of open) until the sent row shows up as one that was not
// there before, or the wait runs out. Uses the wall clock, not deps.now, and returns at once when
// there is no verify reader (so unit tests neither wait nor loop).
export async function verifySent(deps: SendDeps, m: SentMatch, before: Set<string>): Promise<boolean> {
  if (!deps.verifyReader) return false;
  const deadline = Date.now() + VERIFY_WAIT_MS;
  for (;;) {
    for (const id of findSent(freshReader(deps), m)) {
      if (!before.has(id)) return true;
    }
    if (Date.now() + VERIFY_STEP_MS > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, VERIFY_STEP_MS));
  }
}

/**
 * The checks made before opening the LINE database: a given reply_to must be a message
 * id, the input at most 1 MiB, the text valid (see normalizeSendText). Returns the normalized text.
 */
export function checkSendInput(rawText: string, replyTo?: string): { text: string; normalized: boolean } {
  if (replyTo !== undefined) checkReplyId(replyTo);
  if (Buffer.byteLength(rawText, 'utf-8') > MAX_INPUT_BYTES) throw new LineError('INVALID_ARGUMENT', 'message input is larger than 1 MiB');
  return normalizeSendText(rawText);
}

// Fills the dry-run plan's sealing vectors from the native core (the only place text is sealed).
// A missing core fails the dry run; there is no TypeScript fallback.
async function applyNativeVectors(deps: SendDeps, prepared: PreparedSend): Promise<void> {
  const dryRun = deps.nativeDryRun ?? deps.nativeSend;
  if (!dryRun) throw new LineError('NATIVE_CORE_UNAVAILABLE', 'LINE native send core is not wired in');
  const res = await nativeTextDryRun({
    chatId: prepared.chatId, from: prepared.from, text: prepared.text, ready: prepared.keys, mentionMeta: prepared.mentionMeta,
    clientId: prepared.clientId, createdTime: prepared.createdTime, relatedId: prepared.replyTo,
  }, dryRun);
  const plan = prepared.plan;
  plan.sender_key_id = res.senderKeyId;
  plan.receiver_key_id = res.receiverKeyId;
  plan.e2ee_version = res.e2eeVersion;
  plan.chunk_sizes = res.chunkSizes;
  plan.body_bytes = res.bodyBytes;
  plan.endpoint = res.endpoint ?? plan.endpoint;
}

// Maps a native outcome to a LineError (undefined = sent). The native core already iterated the
// tokens; an uncertain outcome is never retried here.
export function nativeOutcomeError(deps: SendDeps, res: NativeSendResult): LineError | undefined {
  const reason = adaptMessage(res.reason || res.code || res.outcome);
  switch (res.outcome) {
    case 'ok':
      return undefined;
    case 'uncertain':
    case 'server_error':
      return new LineError('SEND_UNCERTAIN', reason);
    case 'blocked':
      return new LineError('SEND_FAILED', `not delivered: ${firewallHint(deps.programPath)}`);
    case 'failed':
    case 'not_sent':
    case 'auth':
      return new LineError('SEND_FAILED', reason);
    default:
      // dryrun or an unknown value on a real send: the outcome cannot be trusted.
      return new LineError('SEND_UNCERTAIN', reason);
  }
}

// Calls the native core exactly once, logs the outcome and throws the mapped error, if any.
async function sendViaNative(
  deps: SendDeps, prepared: PreparedSend,
  input: Parameters<typeof nativeTextSend>[0], entry: SendLogEntry, notify: (note: string) => void,
): Promise<NativeSendResult> {
  let res: NativeSendResult | undefined;
  let error: LineError | undefined;
  try {
    res = await nativeTextSend(input, deps.nativeSend as NativeSender);
    error = nativeOutcomeError(deps, res);
  } catch (err) {
    // The loader failed: a missing core or platform means nothing was posted; anything else may have been.
    error = err instanceof LineError && (err.code === 'NATIVE_CORE_UNAVAILABLE' || err.code === 'UNSUPPORTED_PLATFORM')
      ? err
      : new LineError('SEND_UNCERTAIN', adaptMessage(`the send outcome is unknown (${errorMessage(err)}); check with line_get_history with chat_id ${prepared.chatId} before resending (client message id ${prepared.clientId})`));
  }
  const outcome: SendLogEntry = { ...entry, result: 'OK', server_message_id: res?.serverId && res.serverId !== prepared.clientId ? res.serverId : undefined };
  if (error) {
    outcome.result = error.code;
    outcome.maybe_delivered = res?.outcome === 'server_error';
  }
  try {
    await appendSendLog(deps.storeDir, outcome, deps.now());
  } catch (err) {
    notify(`note: could not write the send log: ${errorMessage(err)}`);
  }
  if (error) throw error;
  return res as NativeSendResult;
}

/**
 * Sends a text message as the user (or, with dryRun, returns the plan without sending). The chat is
 * resolved exactly by id or name; only one-to-one chats and groups are allowed. Notes line-cli prints
 * on stderr (not a friend, a likely duplicate, mis-encoded text) go to opts.notify.
 */
export async function sendText(reader: LineReader, to: string, rawText: string, opts: SendOptions, deps: SendDeps): Promise<SendPlan> {
  const notify = opts.notify ?? (() => undefined);
  const { text, normalized } = checkSendInput(rawText, opts.replyTo);
  if (text.includes('\ufffd')) {
    notify('warning: the text contains U+FFFD replacement characters, so it may have been mis-encoded before Yobi read it');
  }
  // The message to quote is looked up in a fresh read: the shared handle sees the database as of
  // when it opened, and that message may have come since.
  const replyReader = opts.replyTo ? freshReader(deps) ?? reader : reader;
  const prepared = await prepareSend(reader, deps.nativeKeys, to, text, normalized, deps.now(), { replyTo: opts.replyTo, replyReader, mention: opts.mention, mentionAll: opts.mentionAll });
  if (prepared.contactWarning) notify(`note: ${prepared.contactWarning}`);
  const plan = prepared.plan;

  const dup = await recentDuplicate(deps.storeDir, prepared.chatId, prepared.dedupeKey, deps.now());
  if (opts.dryRun) {
    await applyNativeVectors(deps, prepared);
    if (dup && !opts.allowDuplicate) notify(duplicateNote(dup));
    return plan;
  }
  if (dup && !opts.allowDuplicate) throw new LineError('DUPLICATE_SEND', duplicateMessage(dup));

  if (!deps.nativeSend) throw new LineError('NATIVE_CORE_UNAVAILABLE', 'LINE native send core is not wired in');
  const tokens = await deps.tokens();
  if (tokens.length === 0) throw new LineError('TOKEN_NOT_FOUND', 'no access token candidates');
  const match: SentMatch = {
    chatId: prepared.chatId,
    own: new Set([prepared.from, ...reader.ownIds()]),
    sinceMs: prepared.createdTime - VERIFY_SKEW_MS,
    serverID: '',
    text: prepared.text,
    relatedId: prepared.replyTo,
  };
  // Rows already there just before the POST are not the one we send.
  const before = findSent(freshReader(deps) ?? reader, match);
  const entry: SendLogEntry = { to: prepared.chatId, sha256: prepared.dedupeKey, length: plan.text_length, result: '', client_message_id: prepared.clientId };
  const nativeInput = {
    chatId: prepared.chatId, from: prepared.from, text: prepared.text, ready: prepared.keys, mentionMeta: prepared.mentionMeta,
    clientId: prepared.clientId, createdTime: prepared.createdTime, relatedId: prepared.replyTo,
    tokens, clientEnv: deps.clientEnv(),
  };
  await claimSend(deps, entry, opts.allowDuplicate === true);
  const res = await sendViaNative(deps, prepared, nativeInput, entry, notify);

  plan.dry_run = false;
  plan.sent = true;
  plan.chunk_sizes = res.chunkSizes ?? plan.chunk_sizes;
  plan.body_bytes = res.bodyBytes ?? plan.body_bytes;
  plan.endpoint = res.endpoint ?? plan.endpoint;
  // An id that only echoes the client id is not a server id.
  const serverID = res.serverId && res.serverId !== prepared.clientId ? res.serverId : '';
  if (serverID) plan.server_message_id = serverID;
  const createdTime = res.createdTimeMs ?? 0;
  if (createdTime > 0) {
    plan.sent_at = tsToIso(createdTime) ?? undefined;
    match.sinceMs = Math.min(match.sinceMs, createdTime - VERIFY_SKEW_MS);
  }
  match.serverID = serverID;
  plan.verified = await verifySent(deps, match, before);
  return plan;
}
