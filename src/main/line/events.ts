import type { webhook } from '@line/bot-sdk';

export type LineChatKind = 'user' | 'group' | 'room';

export interface LineTextEvent {
  userId: string;
  // Push destination for replies: the userId in a 1:1 chat, the groupId/roomId
  // in a multi-person chat.
  chatId: string;
  chatKind: LineChatKind;
  replyToken?: string;
  // Message text with the bot's own @-mentions already stripped.
  text: string;
  // True when the sender explicitly tagged this bot (mention.mentionees[].isSelf).
  mentionsBot: boolean;
}

// Extract text messages from a parsed webhook body. 1:1, group and room sources
// are handled; group/room events without a sender userId are dropped (LINE omits
// it when the sender never friended the bot — such a sender cannot be paired
// anyway). Stickers/images, follow/unfollow and other event types are ignored.
//
// Exported for the test suite: pure, offline, deterministic.
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

// Removes the '@Bot' substrings that tag this bot (isSelf mentionees) so the
// remaining text can be used verbatim as a prompt.
//
// Ranges resolve defensively: observed payloads use UTF-16 code-unit offsets
// (matching JS slicing), but LINE's docs only say "index of a character" — if
// astral characters (emoji) precede the mention and the platform counted code
// points, the raw offsets would cut real prompt text. A range is only removed
// when its resolved slice starts at a mention's '@'; an unresolvable range is
// left in place (a literal '@Bot' in the prompt is harmless, a corrupted
// prompt is not).
//
// Exported for the test suite: pure, offline, deterministic.
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
  // Fallback: interpret index/length as code-point counts.
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
