import { TELEGRAM_MESSAGE_MAX } from '../../shared/botMessageLimits';
import { expandableQuote, expandableQuoteBody } from '../../shared/expandableQuote';
import { escapePostMarkdown, xPostMessage, type XMessageParts } from '../../shared/xMedia';
import {
  chunkCut,
  formatResponseForTelegramHtml,
  splitMarkdownIntoChunks,
  telegramCompactChunks,
  telegramHtmlFits,
  telegramMessageWeight,
} from './formatter';

function fitsOneMessage(markdown: string): boolean {
  return telegramHtmlFits(formatResponseForTelegramHtml(markdown), TELEGRAM_MESSAGE_MAX);
}

function unquoted(line: string): string {
  return line.replace(/^> ?/, '');
}

/** The first folded quote of a message, its text out of the quote, and what stands around it. */
function foldedQuote(markdown: string): { before: string; body: string; after: string } | null {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.startsWith('>') && expandableQuoteBody(unquoted(line)) !== null);
  if (start < 0) return null;
  const next = lines.findIndex((line, index) => index > start && !line.startsWith('>'));
  const end = next < 0 ? lines.length : next;
  return {
    before: lines.slice(0, start).join('\n').trim(),
    body: lines.slice(start + 1, end).map(unquoted).join('\n').trim(),
    after: lines.slice(end).join('\n').trim(),
  };
}

/**
 * Far more than the messages could hold, whatever Markdown drops. Each cut renders the text again,
 * and this runs on the main process: 80,000 characters of short paragraphs took 16 s to come to
 * the same null. Twice the room, because escapes and quote marks count here and not on screen.
 */
function plainlyTooLong(markdown: string, maxChunkChars: number, maxChunks: number): boolean {
  return markdown.replace(/\]\([^)\n]*\)/g, ']').length > maxChunkChars * maxChunks * 2;
}

/**
 * The messages for a text a chat should get whole: one while it fits, else split at paragraphs into
 * at most `maxChunks` of about `maxChunkChars`; null when that is not enough, for the caller to send
 * it some other way. A folded quote is cut out of the quote and each piece folded again: cut as
 * text, what follows would fall out of it. What stands around the quote (who wrote it, the link)
 * stays on the first and last message.
 */
export function telegramMessageChunks(markdown: string, maxChunkChars: number, maxChunks: number): string[] | null {
  if (!markdown) return [];
  if (plainlyTooLong(markdown, maxChunkChars, maxChunks)) return null;
  if (fitsOneMessage(markdown)) return [markdown];
  // One over: enough to know the text is too long without cutting all of it.
  const chunksOf = (text: string): string[] => telegramCompactChunks(text, maxChunkChars, maxChunks + 1);
  const fold = foldedQuote(markdown);
  // Weighed folded: the fold is an entity too.
  const foldedPieces = (body: string): string[] => splitMarkdownIntoChunks(
    body, maxChunkChars, maxChunks + 1, (piece) => telegramMessageWeight(expandableQuote(piece), maxChunkChars),
  ).map(expandableQuote);
  const chunks = fold?.body ? foldedPieces(fold.body) : chunksOf(markdown);
  if (fold?.body) {
    const opened = fold.before ? `${fold.before}\n\n${chunks[0]}` : chunks[0];
    if (fitsOneMessage(opened)) chunks[0] = opened;
    else chunks.unshift(...chunksOf(fold.before));
    const last = chunks.length - 1;
    const closed = fold.after ? `${chunks[last]}\n\n${fold.after}` : chunks[last];
    if (fitsOneMessage(closed)) chunks[last] = closed;
    else chunks.push(...chunksOf(fold.after));
  }
  return chunks.length > maxChunks ? null : chunks;
}

/**
 * A post too long for the caption under its media: who wrote it, as much of the text as fits and
 * the link, weighed as Telegram counts a caption; and the rest of the text, folded, to follow. No
 * rest when it all fits after all: escapes, the quote's marks and long URLs cost nothing there.
 */
export function telegramCaptionLead(post: XMessageParts, maxVisibleChars: number): { lead: string; rest: string } {
  const text = post.text.trim();
  const leadOf = (part: string): string => xPostMessage({ ...post, text: part }, true);
  const weigh = (part: string): number => telegramMessageWeight(leadOf(part), maxVisibleChars);
  if (!text || weigh(text) <= maxVisibleChars) return { lead: leadOf(text), rest: '' };
  const cut = chunkCut(text, maxVisibleChars, weigh);
  return { lead: leadOf(text.slice(0, cut).trim()), rest: expandableQuote(escapePostMarkdown(text.slice(cut).trim())) };
}
