/**
 * What a LINE PC chat brings to an agent run, read from LINE's own database when the run starts:
 * the message the request quotes (LINE's Reply), in any chat, and — in a group with other people —
 * the talk around it, with the windows and budgets every platform shares (`chatContextWindow.ts`).
 * A 1:1 chat and the user's one-person group bring no talk: a 1:1 chat's other side is read no
 * further than its "Yobi" lines, and the one-person group holds the user's own notes. Yobi's own
 * answers, events, unsent and undecryptable rows are not talk.
 */
import type { AgentChatLine, AgentReplyContext } from '../../shared/types';
import { CHAT_CONTEXT_LIMITS, chatContextLines, type ChatTalkEntry } from '../botChat/chatContextWindow';
import { asksAboutTheChat } from '../botChat/chatRecap';
import type { BotAgentContext } from '../botChat/types';
import { targetMessage } from '../line/lineSendReply';
import type { LineReader } from '../line/reader';
import type { ParsedMessage } from '../line/schema';
import { LINE_SELF_REPLY_PREFIX, isYobiReply } from './text';

/** The request, as the runtime knows it. */
export interface LineSelfContextRequest {
  /** The LINE chat it was typed in. */
  lineChatId: string;
  /** Who asked. */
  userId: string;
  /** When LINE stored it (ms). */
  sentAt: number;
  /** The message it quotes (LINE's Reply), when it does. */
  replyToId?: string;
  /** The request is the link the quoted message is made of: that message is the request itself. */
  fromQuotedLink?: boolean;
  /** The user's one-person group: every answer of Yobi's there answered the user. */
  privateChat: boolean;
  /** A group with other people in it (or members unknown): its talk goes with the run. */
  sharedGroup: boolean;
  /** The user's own name, for their lines; '' when LINE has none. */
  ownName: string;
}

const MESSAGE_TABLE = '_message';
/** Rows read past the lines kept, for the ones dropped (events, Yobi's answers…). */
const ROW_SLACK = 4;
/** The most rows a recap reads; the budget trims them again. */
const RECAP_ROWS = 500;

/** In the model's words, by LINE's content type (a sticker's text is LINE's own "[貼圖]"). */
const MEDIA_BY_TYPE: Readonly<Record<string, string>> = {
  image: 'photo',
  video: 'video',
  audio: 'audio file',
  file: 'file',
  sticker: 'sticker',
  location: 'location',
};
const UNDECRYPTABLE = 'encrypted message';

function senderName(message: ParsedMessage, ownName: string): string {
  if (message.from_me) return ownName;
  const name = message.sender ?? '';
  return name && name !== message.sender_id ? name : '';
}

/** A row as one line of talk; '' for what is no talk. */
function talkText(message: ParsedMessage): string {
  if (message.type === 'event' || message.type === 'unsent' || message.undecryptable) return '';
  const content = (message.content ?? '').trim();
  if (isYobiReply(content)) return '';
  const media = MEDIA_BY_TYPE[message.type];
  const words = message.type === 'sticker' ? '' : (message.type === 'file' ? message.filename ?? content : content);
  const text = words.slice(0, CHAT_CONTEXT_LIMITS.lineTextMax);
  if (!media) return message.type === 'call' ? '' : text;
  return `[${media}]${text ? ` ${text}` : ''}`;
}

/** The message the request quotes, as the agent is shown it; undefined when it cannot be read here. */
function quotedMessage(reader: LineReader, request: LineSelfContextRequest): AgentReplyContext | undefined {
  if (!request.replyToId || request.fromQuotedLink) return undefined;
  let message: ParsedMessage;
  try {
    message = targetMessage(reader, request.lineChatId, request.replyToId, 'reply_to', 'replied to').message;
  } catch {
    return undefined;
  }
  const content = message.content ?? '';
  const self = message.from_me === true && isYobiReply(content);
  const text = self
    ? content.trimStart().slice(LINE_SELF_REPLY_PREFIX.length).trim()
    : message.type === 'sticker' ? '' : content.trim();
  const media = message.undecryptable ? UNDECRYPTABLE : MEDIA_BY_TYPE[message.type];
  const shown = message.type === 'file' && !text ? message.filename ?? '' : text;
  if (!shown && !media) return undefined;
  // Yobi's answer outside the user's own group may answer someone else's request: their words.
  const asker = self ? request.privateChat : message.sender_id === request.userId;
  return {
    from: self ? '' : senderName(message, request.ownName),
    text: shown,
    ...(self ? { self: true } : {}),
    ...(asker ? { asker: true as const } : {}),
    ...(media ? { media } : {}),
  };
}

/** Rows of the chat, newest first as read, returned oldest first. */
function rowsBetween(reader: LineReader, chatId: string, range: { afterMs?: number; beforeMs: number }, limit: number): Array<{ row: Record<string, unknown>; atMs: number }> {
  const access = reader.access();
  const after = range.afterMs === undefined ? '' : ' AND _createdTime > ?';
  const rows = access.all(
    // Messages of the same millisecond in the order LINE numbered them (ids grow; compared as numbers).
    `SELECT * FROM ${MESSAGE_TABLE} WHERE _chatId = ? AND _createdTime < ?${after} ORDER BY _createdTime DESC, length(_id) DESC, _id DESC LIMIT ?`,
    [chatId, range.beforeMs, ...(range.afterMs === undefined ? [] : [range.afterMs]), limit],
  );
  return rows.reverse().map((row) => ({ row, atMs: Number(row._createdTime) || 0 }));
}

function talkEntries(reader: LineReader, rows: ReadonlyArray<{ row: Record<string, unknown>; atMs: number }>, ownName: string): ChatTalkEntry[] {
  const parse = reader.access().parser();
  return rows.flatMap(({ row, atMs }) => {
    const message = parse(row);
    const text = talkText(message);
    if (!text || !message.id) return [];
    return [{ id: message.id, atMs, from: senderName(message, ownName), text, ...(message.sender_id ? { fromId: message.sender_id } : {}) }];
  });
}

/** The group's talk around the request: the window it replies into, else the last of the hours before it. */
function groupTalk(reader: LineReader, request: LineSelfContextRequest, recap: boolean): AgentChatLine[] {
  const limits = CHAT_CONTEXT_LIMITS;
  const chatId = request.lineChatId;
  const repliedId = request.replyToId && !request.fromQuotedLink ? request.replyToId : undefined;
  const replied = repliedId
    ? reader.access().get(`SELECT * FROM ${MESSAGE_TABLE} WHERE _id = ? AND _chatId = ?`, [repliedId, chatId])
    : undefined;
  const repliedMs = Number(replied?._createdTime) || 0;
  let rows: Array<{ row: Record<string, unknown>; atMs: number }>;
  if (replied && repliedMs > 0 && repliedMs < request.sentAt) {
    const before = (recap ? limits.recapBeforeReplied : limits.beforeReplied) * ROW_SLACK;
    const after = recap ? RECAP_ROWS : limits.afterReplied * ROW_SLACK;
    rows = [
      ...rowsBetween(reader, chatId, { beforeMs: repliedMs }, before),
      { row: replied, atMs: repliedMs },
      ...rowsBetween(reader, chatId, { afterMs: repliedMs, beforeMs: request.sentAt }, after),
    ];
  } else {
    const window = recap ? limits.recapWindowMs : limits.unrepliedWindowMs;
    rows = rowsBetween(reader, chatId, { afterMs: request.sentAt - window - 1, beforeMs: request.sentAt }, recap ? RECAP_ROWS : limits.unrepliedLines * ROW_SLACK);
  }
  return chatContextLines(talkEntries(reader, rows, request.ownName), {
    atMs: request.sentAt,
    askerId: request.userId,
    ...(replied ? { repliedId: String(replied._id) } : {}),
    ...(recap ? { recap: true } : {}),
  });
}

/** The quoted message (any chat), and in a group with other people its talk and whether it is a recap. */
export function lineSelfChatContext(reader: LineReader, request: LineSelfContextRequest, input: string): BotAgentContext {
  const replyTo = quotedMessage(reader, request);
  const recap = request.sharedGroup && asksAboutTheChat(input);
  const recentChat = request.sharedGroup ? groupTalk(reader, request, recap) : [];
  return {
    ...(replyTo ? { replyTo } : {}),
    ...(recentChat.length > 0 ? { recentChat } : {}),
    ...(recap ? { chatRecap: true as const } : {}),
  };
}
