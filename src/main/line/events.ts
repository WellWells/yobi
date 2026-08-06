import type { webhook } from '@line/bot-sdk';

export type LineChatKind = 'user' | 'group' | 'room';

export interface LineTextEvent {
  userId: string;
  chatId: string;
  chatKind: LineChatKind;
  replyToken?: string;
  text: string;
  mentionsBot: boolean;
}

export function parseTextEvents(body: webhook.CallbackRequest): LineTextEvent[] {
  const out: LineTextEvent[] = [];
  for (const event of body.events ?? []) {
    if (event.type !== 'message') continue;
    const message = event.message;
    if (message.type !== 'text') continue;
    const source = event.source;
    const userId = source?.userId?.trim();
    if (!source || !userId) continue;

    let chatId = '';
    if (source.type === 'user') chatId = userId;
    else if (source.type === 'group') chatId = source.groupId;
    else if (source.type === 'room') chatId = source.roomId;
    if (!chatId) continue;

    const { text, mentionsBot } = stripBotMentions(message.text, message.mention);
    out.push({
      userId,
      chatId,
      chatKind: source.type,
      replyToken: event.replyToken,
      text,
      mentionsBot,
    });
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
