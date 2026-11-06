/**
 * The LINE PC bot's words on the wire (pure). Yobi answers as the user, so its answers carry a
 * fixed mark the bot skips, and in a chat with other people only a line that starts with "Yobi"
 * or @-mentions the user — whoever types it — is a request.
 */
import { addressedText } from '../botChat/wakeWord';
import type { MentionSpan } from '../line/lineMessageParts';

export { addressedText } from '../botChat/wakeWord';

/**
 * Starts every message Yobi sends as the user. Not translated: it is how the bot tells its own
 * answers from the user's requests, so it must stay the same whatever the app's language.
 */
export const LINE_SELF_REPLY_PREFIX = '[Yobi] ';
const REPLY_MARK = LINE_SELF_REPLY_PREFIX.trim();

/** What may sit between an @-mention taken out of a line and the words around it. */
const SEPARATORS_AT_START = /^[\s,，:：、]+/u;

/** One of Yobi's own answers (never a request, or the bot would answer itself forever). */
export function isYobiReply(text: string): boolean {
  return text.trimStart().startsWith(REPLY_MARK);
}

/**
 * The request in a line that @-mentions the user (`ownMid`), anywhere in it: the line without
 * those "@name"s (and a "Yobi" it may start with too); null when it does not mention them. A span
 * LINE stored that does not start with "@" is left in the text rather than cut at a guess.
 */
export function mentionedRequest(text: string, mentions: readonly MentionSpan[], ownMid: string): string | null {
  const own = mentions.filter((mention) => mention.id === ownMid);
  if (!ownMid || own.length === 0) return null;
  const spans = own
    .flatMap((mention) => (mention.at && /^[@＠]/u.test(text.slice(mention.at.start)) ? [mention.at] : []))
    .sort((a, b) => b.start - a.start);
  let rest = text;
  let limit = text.length;
  for (const { start, end } of spans) {
    if (end > limit) continue;
    rest = rest.slice(0, start) + rest.slice(end);
    limit = start;
  }
  const request = rest.trim().replace(SEPARATORS_AT_START, '');
  return addressedText(request) ?? request;
}

/** A group line's request: one that @-mentions the user, or starts with "Yobi"; null for neither. */
export function groupRequest(text: string, mentions: readonly MentionSpan[], ownMid: string): string | null {
  return mentionedRequest(text, mentions, ownMid) ?? addressedText(text);
}

export function withReplyPrefix(text: string): string {
  return `${LINE_SELF_REPLY_PREFIX}${text}`;
}

/** A flow step's buttons as numbered lines under its text: LINE PC can send no buttons. */
export function numberedMenu(text: string, labels: readonly string[]): string {
  if (labels.length === 0) return text;
  const lines = labels.map((label, index) => `${index + 1}. ${label}`);
  return [text.trim(), lines.join('\n')].filter(Boolean).join('\n\n');
}

/** The menu line a typed number picks ("2", or a full-width "２"), or null. */
export function menuPick(text: string, lines: readonly string[]): string | null {
  const digits = text.trim().normalize('NFKC');
  if (!/^\d{1,2}$/u.test(digits)) return null;
  return lines[Number(digits) - 1] ?? null;
}
