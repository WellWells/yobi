/**
 * Reacting to a stored message and taking back one of your own (line_react, line_unsend). LINE's
 * reply decides the outcome; the local database only confirms it afterwards. After the POST this
 * only returns SEND_FAILED or SEND_UNCERTAIN, as a send does. How old a message may be to unsend is
 * LINE's rule: it is asked, and its answer reported.
 */
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { writeFileAtomic } from '../atomicWrite';
import { isLineError, LineError, type LineErrorCode } from './errors';
import { newClientMessageID } from './lineClientId';
import { REACTION_NAMES } from './lineMessageParts';
import { freshReader, underClaimLock, VERIFY_STEP_MS, VERIFY_WAIT_MS, type SendDeps } from './lineSend';
import { appendSendLog, RESULT_PENDING, type SendLogEntry } from './lineSendLog';
import { targetMessage, type ReplyTarget } from './lineSendReply';
import { resolveSendTarget } from './lineSendText';
import type { NativeActionName, NativeActionRequest, NativeActionResult } from './nativeContract';
import { adaptMessage } from './nativeMessageAdapt';
import type { LineReader } from './reader';

/** Holds the last request number; LINE matches a request and its retries by it. */
const REQ_SEQ_FILE = 'req-seq.txt';
const MAX_REQ_SEQ = 2_000_000_000;

export interface ActionDeps extends Pick<SendDeps, 'tokens' | 'now' | 'storeDir' | 'clientEnv' | 'verifyReader'> {
  nativeAction?: (req: NativeActionRequest) => Promise<NativeActionResult>;
}

/** What line_react and line_unsend do, or did, to a stored message. */
export interface ActionPlan {
  action: NativeActionName;
  to: string;
  to_name: string;
  chat_type: string;
  message_id: string;
  message: ReplyTarget;
  reaction?: string;
  dry_run: boolean;
  sent: boolean;
  verified: boolean;
}

export interface ReactOptions {
  to: string;
  id: string;
  reaction?: string;
  remove?: boolean;
  dryRun: boolean;
}

export interface UnsendOptions {
  to: string;
  id: string;
  dryRun: boolean;
}

/** The next request number, under the same lock as a send, so concurrent actions never share one. */
export async function nextReqSeq(storeDir: string, nowMs: number): Promise<number> {
  return underClaimLock(async () => {
    const file = join(storeDir, REQ_SEQ_FILE);
    let last = 0;
    try {
      last = Number.parseInt((await readFile(file, 'utf-8')).trim(), 10) || 0;
    } catch {
      // No number yet: the clock starts it.
    }
    if (last >= MAX_REQ_SEQ) last = 0;
    const seq = Math.max(nowMs % 1_000_000_000, last + 1, 1);
    await writeFileAtomic(file, String(seq));
    return seq;
  });
}

function planAction(reader: LineReader, fresh: LineReader, action: NativeActionName, cmd: string, verb: string, opt: { to: string; id: string; dryRun: boolean }): { plan: ActionPlan; senderId: string } {
  const { chatId, toName, chatType } = resolveSendTarget(reader, opt.to, cmd);
  const { target, message } = targetMessage(fresh, chatId, opt.id, 'id', verb);
  const plan: ActionPlan = {
    action, to: chatId, to_name: toName, chat_type: chatType, message_id: opt.id, message: target,
    dry_run: opt.dryRun, sent: false, verified: false,
  };
  return { plan, senderId: message.sender_id ?? '' };
}

async function pollFresh(deps: ActionDeps, done: (reader: LineReader) => boolean): Promise<boolean> {
  if (!deps.verifyReader) return false;
  const deadline = Date.now() + VERIFY_WAIT_MS;
  for (;;) {
    const reader = freshReader(deps);
    try {
      if (reader && done(reader)) return true;
    } catch {
      // A failed read only costs the confirmation, never the action.
    }
    if (Date.now() + VERIFY_STEP_MS > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, VERIFY_STEP_MS));
  }
}

async function logAction(deps: ActionDeps, entry: SendLogEntry): Promise<void> {
  await appendSendLog(deps.storeDir, entry, deps.now());
}

// Posts one call and confirms it in the local database.
async function runAction(plan: ActionPlan, reaction: number, deps: ActionDeps, done: (reader: LineReader) => boolean): Promise<void> {
  if (!deps.nativeAction) throw new LineError('NATIVE_CORE_UNAVAILABLE', 'LINE native send core is not wired in');
  const tokens = await deps.tokens();
  if (tokens.length === 0) throw new LineError('TOKEN_NOT_FOUND', 'no access token candidates');
  let seq: number;
  try {
    seq = await nextReqSeq(deps.storeDir, deps.now());
  } catch (err) {
    throw new LineError('SEND_FAILED', `not sent: could not take a request number: ${err instanceof Error ? err.message : String(err)}`);
  }
  const clientId = newClientMessageID();
  // An action can be repeated safely, so the duplicate guard stays out of it.
  const entry: SendLogEntry = { to: plan.to, action: plan.action, message_id: plan.message_id, sha256: '', length: 0, result: '', client_message_id: clientId };
  try {
    await logAction(deps, { ...entry, result: RESULT_PENDING, time: '' });
  } catch (err) {
    throw new LineError('SEND_FAILED', `not sent: could not write the send log: ${err instanceof Error ? err.message : String(err)}`);
  }
  let error: LineError | undefined;
  try {
    const res = await deps.nativeAction({
      action: plan.action, chatId: plan.to, messageId: plan.message_id, ...(reaction ? { reaction } : {}),
      seq, clientId, clientEnv: deps.clientEnv(), tokens,
    });
    if (res.outcome !== 'ok') error = new LineError((res.code || 'SEND_UNCERTAIN') as LineErrorCode, adaptMessage(res.reason || res.outcome));
  } catch (err) {
    // The loader failed: a missing core or platform means nothing was posted; anything else may have been.
    error = isLineError(err) && (err.code === 'NATIVE_CORE_UNAVAILABLE' || err.code === 'UNSUPPORTED_PLATFORM')
      ? err
      : new LineError('SEND_UNCERTAIN', adaptMessage(`the outcome is unknown (${err instanceof Error ? err.message : String(err)}); check with line_get_history with chat_id ${plan.to}`));
  }
  try {
    await logAction(deps, { ...entry, result: error?.code ?? 'OK', time: '' });
  } catch {
    // The action is done either way; the log only guards a later repeat.
  }
  if (error) throw error;
  plan.sent = true;
  plan.dry_run = false;
  plan.verified = await pollFresh(deps, done);
}

function ownIds(reader: LineReader, from: string): Set<string> {
  return new Set([from, ...reader.ownIds()]);
}

/** Adds a reaction to a stored message, or removes yours. */
export async function reactToMessage(reader: LineReader, opt: ReactOptions, deps: ActionDeps): Promise<ActionPlan> {
  const name = opt.reaction ?? '';
  const known = Object.entries(REACTION_NAMES);
  const code = opt.remove ? 0 : Number(known.find(([, n]) => n === name)?.[0] ?? 0);
  if (!opt.remove && code === 0) {
    throw new LineError('INVALID_ARGUMENT', `reaction must be one of ${known.map(([, n]) => n).join(', ')}; got ${JSON.stringify(name)}`);
  }
  const { plan } = planAction(reader, freshReader(deps) ?? reader, opt.remove ? 'remove_reaction' : 'react', 'line_react', 'reacted to', opt);
  if (!opt.remove) plan.reaction = name;
  if (opt.dryRun) return plan;
  const own = ownIds(reader, reader.myMid());
  await runAction(plan, code, deps, (fresh) => fresh.ownReactionCode(opt.id, own) === code);
  return plan;
}

/** Takes back one of your own messages. */
export async function unsendMessage(reader: LineReader, opt: UnsendOptions, deps: ActionDeps): Promise<ActionPlan> {
  const { plan, senderId } = planAction(reader, freshReader(deps) ?? reader, 'unsend', 'line_unsend', 'unsent', opt);
  if (!ownIds(reader, reader.myMid()).has(senderId)) {
    throw new LineError('INVALID_ARGUMENT', `message ${opt.id} is not your own; you can unsend only your own messages`);
  }
  if (opt.dryRun) return plan;
  await runAction(plan, 0, deps, (fresh) => fresh.isUnsent(opt.id));
  return plan;
}
