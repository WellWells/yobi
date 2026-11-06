/**
 * Replying to a stored message (line_send's reply_to, line-cli's --reply-to). LINE quotes the message a reply names; the
 * send plan shows that message so the user can check it is the right one before anything is sent.
 */
import { LineError } from './errors';
import { clipRunes, goQuote } from './lineGoText';
import type { LineReader } from './reader';
import type { ParsedMessage } from './schema';

/** The stored message a reply quotes, for the user to check. */
export interface ReplyTarget {
  id: string;
  sender: string;
  sent_at: string;
  type: string;
  content?: string;
}

const needsId = (flag: string): string => `${flag} needs a LINE message id (digits), such as an id from line_get_history with ids: true, line_search_messages or line_get_unread with ids: true`;

/** Throws INVALID_ARGUMENT unless id looks like a LINE message id (digits only). */
export function checkReplyId(id: string): void {
  if (/^[0-9]+$/.test(id)) return;
  throw new LineError('INVALID_ARGUMENT', `${needsId('reply_to')}; got ${goQuote(id)}`);
}

/**
 * The tool's reply_to argument: absent (undefined or null) is a plain message. An id must come as a
 * string — an 18-digit number has already lost its last digits to JSON, and could name another message.
 */
export function replyToArgument(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  throw new LineError('INVALID_ARGUMENT', `${needsId('reply_to')}; got the ${typeof value} ${String(value)}, pass the id as a string`);
}

/**
 * The message a reply to chatId quotes: it must be stored on this PC, be in that chat, and be
 * something a person sent (not a system event, not unsent). The sender is named as read names it;
 * the content is the text, else the file name, clipped to 100 characters.
 */
export function replyTarget(reader: LineReader, chatId: string, id: string): ReplyTarget {
  return targetMessage(reader, chatId, id, 'reply_to', 'replied to').target;
}

/**
 * The stored message a tool argument names, under the same rules; `flag` and `verb` name them in
 * the errors. The parsed message comes with it, for checks of the caller's own.
 */
export function targetMessage(reader: LineReader, chatId: string, id: string, flag: string, verb: string): { target: ReplyTarget; message: ParsedMessage } {
  if (!/^[0-9]+$/.test(id)) throw new LineError('INVALID_ARGUMENT', `${needsId(flag)}; got ${goQuote(id)}`);
  const at = reader.messageChat(id);
  if (at !== chatId) {
    throw new LineError('INVALID_ARGUMENT', `message ${id} is not in this chat (it is in ${at}); ${flag} must name a message of the chat you send to`);
  }
  const m = reader.storedMessage(id);
  if (!m) throw new LineError('INVALID_ARGUMENT', `no message with id ${id} in the local database`);
  if (m.type === 'event') {
    throw new LineError('INVALID_ARGUMENT', `message ${id} is a system event, not a message; ${flag} must name a message someone sent`);
  }
  if (m.type === 'unsent') {
    throw new LineError('INVALID_ARGUMENT', `message ${id} was unsent by its sender, so it cannot be ${verb}`);
  }
  const target: ReplyTarget = { id, sender: m.sender ?? '', sent_at: m.sent_at ?? '', type: m.type };
  const content = clipRunes(m.content ?? m.filename ?? '', 100);
  if (content) target.content = content;
  return { target, message: m };
}
