import type { webhook } from '@line/bot-sdk';
import type { BotChatEvent, BotChatKind } from '../botChat/types';

export type LineChatKind = BotChatKind;

/** A typed line (`sentAt` = LINE's `timestamp`; `redelivered` = LINE's `isRedelivery`). */
export interface LineTextEvent extends BotChatEvent {
  /** Answering with it is free; it lapses soon after the message (`messaging.ts` then pushes). */
  replyToken?: string;
}

export function parseTextEvents(body: webhook.CallbackRequest): LineTextEvent[] {
  const out: LineTextEvent[] = [];
  for (const event of body.events ?? []) {
    if (event.type !== 'message') continue;
    const message = event.message;
    if (message.type !== 'text') continue;
    const where = senderOf(event.source);
    if (!where) continue;

    const { text, mentionsBot } = stripBotMentions(message.text, message.mention);
    out.push({
      ...where,
      replyToken: event.replyToken,
      text,
      mentionsBot,
      ...(Number.isFinite(event.timestamp) && event.timestamp > 0 ? { sentAt: event.timestamp } : {}),
      ...(event.deliveryContext?.isRedelivery === true ? { redelivered: true as const } : {}),
    });
  }
  return out;
}

/** Who sent an event and in which chat; null without a user id (LINE omits it for some group events). */
function senderOf(source: webhook.Source | undefined): { userId: string; chatId: string; chatKind: LineChatKind } | null {
  const userId = source?.userId?.trim();
  if (!source || !userId) return null;
  let chatId = '';
  if (source.type === 'user') chatId = userId;
  else if (source.type === 'group') chatId = source.groupId;
  else if (source.type === 'room') chatId = source.roomId;
  return chatId ? { userId, chatId, chatKind: source.type } : null;
}

/** A tap on a postback button: who, where, the reply token (a reply is free) and the data as sent. */
export interface LinePostbackEvent {
  userId: string;
  chatId: string;
  chatKind: LineChatKind;
  replyToken?: string;
  /** Whatever the tapping client sent back; checked by the handler of its prefix. */
  data: string;
}

export function parsePostbackEvents(body: webhook.CallbackRequest): LinePostbackEvent[] {
  const out: LinePostbackEvent[] = [];
  for (const event of body.events ?? []) {
    if (event.type !== 'postback') continue;
    const data = event.postback?.data;
    const where = senderOf(event.source);
    if (typeof data !== 'string' || !data || !where) continue;
    out.push({ ...where, ...(event.replyToken ? { replyToken: event.replyToken } : {}), data });
  }
  return out;
}

/** The bot was added to, or removed from, a group or a multi-person chat. */
export interface LineChatEvent {
  type: 'join' | 'leave';
  chatId: string;
  chatKind: 'group' | 'room';
}

/**
 * Joins and leaves, so the settings page can list the groups the bot is in and set what each one
 * grants. (LINE sends no join for groups the bot was already in; their first message registers them.)
 */
export function parseChatEvents(body: webhook.CallbackRequest): LineChatEvent[] {
  const out: LineChatEvent[] = [];
  for (const event of body.events ?? []) {
    if (event.type !== 'join' && event.type !== 'leave') continue;
    const source = event.source;
    if (source?.type === 'group' && source.groupId) out.push({ type: event.type, chatId: source.groupId, chatKind: 'group' });
    else if (source?.type === 'room' && source.roomId) out.push({ type: event.type, chatId: source.roomId, chatKind: 'room' });
  }
  return out;
}

export function stripBotMentions(
  rawText: string,
  mention?: webhook.Mention,
): { text: string; mentionsBot: boolean } {
  const selfMentions = (mention?.mentionees ?? [])
    .filter((m): m is webhook.UserMentionee => m.type === 'user' && (m as webhook.UserMentionee).isSelf === true)
    .filter((m) => Number.isInteger(m.index) && Number.isInteger(m.length) && m.index >= 0 && m.length > 0);
  if (selfMentions.length === 0) return { text: rawText.trim(), mentionsBot: false };

  const ranges = selfMentions
    .map((m) => resolveMentionRange(rawText, m.index, m.length))
    .filter((range): range is { start: number; end: number } => range !== null)
    .sort((a, b) => b.start - a.start);

  let text = rawText;
  for (const range of ranges) {
    text = text.slice(0, range.start) + text.slice(range.end);
  }
  return { text: text.trim(), mentionsBot: true };
}

function resolveMentionRange(text: string, index: number, length: number): { start: number; end: number } | null {
  if (text.charAt(index) === '@') return { start: index, end: index + length };
  const start = codePointsToUtf16(text, index);
  const end = codePointsToUtf16(text, index + length);
  if (start !== null && end !== null && text.charAt(start) === '@') return { start, end };
  return null;
}

function codePointsToUtf16(text: string, codePoints: number): number | null {
  let units = 0;
  let remaining = codePoints;
  for (const ch of text) {
    if (remaining === 0) return units;
    units += ch.length;
    remaining -= 1;
  }
  return remaining === 0 ? units : null;
}
