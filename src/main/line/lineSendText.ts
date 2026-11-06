/**
 * Preparing a LINE text message to send: validate
 * and normalize the text, resolve the recipient, check the E2EE key state, and build the plan.
 * Sealing, the request body and the POST all happen in the native core; this file
 * holds no send crypto or wire format. Pure and offline.
 */
import { createHash } from 'node:crypto';
import { LineError, type LineErrorCode } from './errors';
import { goQuote, isGoBlank } from './lineGoText';
import type { LineReader } from './reader';
import { newClientMessageID } from './lineClientId';
import { dedupeKey, mentionMeta, mentionTargets, planMentions, type MentionSpan, type MentionTarget } from './lineMention';
import { replyTarget, type ReplyTarget } from './lineSendReply';
import type { NativeKeysRequest, NativeKeysResult, NativeSendKeys } from './nativeContract';

const MAX_TEXT_CHARS = 10_000;

/** A control character other than line feed and tab (which LINE does not display). */
function isHiddenControl(cp: number): boolean {
  if (cp === 0x0a || cp === 0x09) return false;
  return cp < 0x20 || cp === 0x7f || (cp >= 0x80 && cp <= 0x9f);
}

// A lone UTF-16 surrogate has no UTF-8 encoding: the JS form of Go's invalid UTF-8.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * Validates and normalizes send text: strips a leading BOM, converts CRLF/CR to LF, trims trailing
 * line breaks. Throws INVALID_ARGUMENT for text that is not valid UTF-8, NUL, a hidden control
 * character, empty text, or text over 10000 Unicode characters. `normalized` is true when the BOM
 * or line-break rewrite changed the text (trimming trailing line breaks alone does not count).
 */
export function normalizeSendText(input: string): { text: string; normalized: boolean } {
  if (LONE_SURROGATE.test(input)) {
    throw new LineError('INVALID_ARGUMENT', 'message text is not valid UTF-8; pass UTF-8 text');
  }
  let out = input.startsWith('\ufeff') ? input.slice(1) : input;
  out = out.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n+$/, '');
  const normalized = out !== input.replace(/[\r\n]+$/, '');
  if (out.includes('\u0000')) {
    throw new LineError('INVALID_ARGUMENT', 'message text contains NUL characters (UTF-16 input?); pass UTF-8 text');
  }
  for (const ch of out) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isHiddenControl(cp)) {
      throw new LineError('INVALID_ARGUMENT', `message text contains the control character U+${cp.toString(16).toUpperCase().padStart(4, '0')}, which LINE does not show; remove it (line breaks and tabs are allowed)`);
    }
  }
  if (isGoBlank(out)) throw new LineError('INVALID_ARGUMENT', 'message text is empty');
  const length = [...out].length;
  if (length > MAX_TEXT_CHARS) {
    throw new LineError('INVALID_ARGUMENT', `message text is too long: ${length} characters (limit ${MAX_TEXT_CHARS} Unicode characters); split it into several messages`);
  }
  return { text: out, normalized };
}

/** Message content types (LINE's ContentType enum) a send uses. */
export const CONTENT_TEXT = 0;
export const CONTENT_IMAGE = 1;
export const CONTENT_VIDEO = 2;
export const CONTENT_FILE = 14;

/** Picks the keys to seal to a chat from its stored columns; the native core reads the stored format. */
export type NativeKeyPicker = (req: NativeKeysRequest) => Promise<NativeKeysResult>;

/** The keys a send seals with. Key material: it goes into the native request and nowhere else. */
export interface ReadyKeys {
  /** 1 for a one-to-one chat, 2 for a group. */
  version: 1 | 2;
  keys: NativeSendKeys;
}

/**
 * The keys to seal to a chat, or why there are none: disabled -> E2EE_DISABLED,
 * no_key -> E2EE_KEY_MISSING, stored keys that cannot be read -> DB_UNREADABLE.
 */
export async function readySendKeys(reader: LineReader, chatId: string, pick: NativeKeyPicker | undefined): Promise<ReadyKeys> {
  if (!pick) throw new LineError('NATIVE_CORE_UNAVAILABLE', 'LINE native send core is not wired in');
  const km = await pick({ chatId, ...reader.sendKeyRows(chatId) });
  if (km.code) throw new LineError(km.code as LineErrorCode, km.reason || km.code);
  if (km.state === 'disabled') {
    throw new LineError('E2EE_DISABLED', 'this chat does not use Letter Sealing; plain-text send is not supported yet');
  }
  if (km.state === 'no_key') {
    throw new LineError('E2EE_KEY_MISSING', km.version === 2
      ? "the group's E2EE key is not cached locally; open this group once in the LINE app (that fetches its key), then retry"
      : "recipient's E2EE public key is not cached locally; open this chat once in the LINE app (that exchanges keys), then retry");
  }
  if (!km.keys) throw new LineError('DB_UNREADABLE', 'no usable E2EE key found');
  return { version: km.version === 2 ? 2 : 1, keys: km.keys };
}

/** What a send did or (for a dry run) would do; keys in line-cli's order. Never key material or the token. */
export interface SendPlan {
  to: string;
  to_name: string;
  chat_type: string;
  from: string;
  text: string;
  text_length: number;
  text_sha256: string;
  normalized: boolean;
  /** The message this one replies to (reply_to), as LINE quotes it. */
  reply_to?: ReplyTarget;
  /** The words the message tags (mention, mention_all). */
  mentions?: MentionSpan[];
  mentions_all?: boolean;
  sender_key_id: number;
  receiver_key_id: number;
  e2ee_version: number;
  chunk_sizes: number[];
  body_bytes: number;
  endpoint: string;
  dry_run: boolean;
  sent: boolean;
  verified: boolean;
  server_message_id?: string;
  sent_at?: string;
}

/** Everything a send needs: the plan to show (sealing vectors filled in by the native core). */
export interface PreparedSend {
  plan: SendPlan;
  clientId: string;
  createdTime: number;
  chatId: string;
  from: string;
  text: string;
  keys: ReadyKeys;
  /** What the duplicate guard compares: the text, plus who it tags. */
  dedupeKey: string;
  /** The MENTION metadata value; '' when the message tags no one. */
  mentionMeta: string;
  /** The id of the message this one replies to; '' for none. */
  replyTo: string;
  /** Set when the recipient is not a friend in contacts, to warn before sending. */
  contactWarning?: string;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

/** Who a send goes to, resolved: the chat, its type as a send names it, and my id. */
export interface SendTarget {
  chatId: string;
  /** The chat's name for the plan: a group's name, a person's display name. */
  toName: string;
  /** Its type, `self` for my own chat. */
  chatType: string;
  from: string;
  /** Set when the recipient is not a friend in contacts, to warn before sending. */
  contactWarning: string;
}

/**
 * Resolves the recipient of a send exactly (by id or name). Only one-to-one chats and groups are
 * allowed; anything else is INVALID_ARGUMENT with the chat as the candidate.
 */
export function resolveSendTarget(reader: LineReader, to: string, cmd = 'send'): SendTarget {
  const chat = reader.resolveChatInfo(to, true);
  const chatId = chat.chat_id;
  const group = chatId.startsWith('c');
  if (!chatId.startsWith('u') && !group) {
    throw new LineError(
      'INVALID_ARGUMENT',
      `${cmd} supports one-to-one chats and groups only; ${goQuote(to)} is a ${chat.type} chat (see candidates)`,
      [{ chat_id: chatId, name: chat.name, type: chat.type }],
    );
  }
  const from = reader.myMid();
  let chatType = chat.type as string;
  let contactWarning = '';
  if (chatId === from) chatType = 'self';
  else if (!group) contactWarning = reader.contactWarning(chatId);
  const toName = group ? chat.name || chatId : reader.displayNameOf(chatId);
  return { chatId, toName, chatType, from, contactWarning };
}

export interface PrepareOptions {
  /** A stored message id of the same chat: the message then replies to it. */
  replyTo?: string;
  /** Where replyTo is looked up; the main reader when absent. */
  replyReader?: LineReader;
  /** People to tag: a member id, a member's exact name, or <word>=<id>. */
  mention?: readonly string[];
  mentionAll?: boolean;
}

function planChatMentions(reader: LineReader, chatId: string, text: string, opt: PrepareOptions): MentionSpan[] {
  const people = opt.mention ?? [];
  if (people.length === 0 && !opt.mentionAll) return [];
  if (!chatId.startsWith('c')) throw new LineError('INVALID_ARGUMENT', 'mention and mention_all work in groups only');
  let targets: MentionTarget[] = [];
  if (people.length > 0) {
    const members = reader.joinedMembers(chatId);
    if (!members) throw new LineError('INVALID_ARGUMENT', 'this PC has no member list for the group; open it once in LINE, then retry');
    targets = mentionTargets(chatId, members, people);
  }
  return planMentions(text, targets, opt.mentionAll === true);
}

/**
 * Resolves the recipient, checks the E2EE key state and builds the plan. The sealing vectors
 * (chunk_sizes, body_bytes) start empty: the native core computes them (dry run) or returns them
 * (real send). Does not touch the network.
 */
export async function prepareSend(
  reader: LineReader,
  pick: NativeKeyPicker | undefined,
  to: string,
  text: string,
  normalized: boolean,
  now: number,
  opt: PrepareOptions = {},
): Promise<PreparedSend> {
  const { chatId, toName, chatType, from, contactWarning } = resolveSendTarget(reader, to);
  const replyTo = opt.replyTo ?? '';
  const reply = replyTo ? replyTarget(opt.replyReader ?? reader, chatId, replyTo) : undefined;
  const spans = planChatMentions(reader, chatId, text, opt);
  const { version, keys } = await readySendKeys(reader, chatId, pick);
  const clientId = newClientMessageID();
  const plan: SendPlan = {
    to: chatId,
    to_name: toName,
    chat_type: chatType,
    from,
    text,
    text_length: [...text].length,
    text_sha256: sha256Hex(text),
    normalized,
    ...(reply ? { reply_to: reply } : {}),
    ...(spans.length > 0 ? { mentions: spans } : {}),
    ...(opt.mentionAll ? { mentions_all: true } : {}),
    sender_key_id: keys.myKeyId,
    receiver_key_id: keys.recvKeyId,
    e2ee_version: version,
    chunk_sizes: [],
    body_bytes: 0,
    endpoint: '',
    dry_run: true,
    sent: false,
    verified: false,
  };
  const prepared: PreparedSend = {
    plan, clientId, createdTime: now, chatId, from, text, replyTo, keys: { version, keys },
    dedupeKey: dedupeKey(text, spans), mentionMeta: spans.length > 0 ? mentionMeta(spans) : '',
  };
  if (contactWarning) prepared.contactWarning = contactWarning;
  return prepared;
}
