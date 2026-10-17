/**
 * A quote Telegram shows folded (`<blockquote expandable>`): a few lines and "show more". Markdown
 * has no way to say so, so the quote opens with a line of its own that the Telegram formatter reads
 * and drops. Only a forwarded post's text is written this way; nothing else is
 * folded, and no other channel is sent it.
 */
export const EXPANDABLE_QUOTE_MARK = '[!EXPANDABLE]';

/** `markdown` as a folded quote: every line quoted, so a message cut short still ends inside it. */
export function expandableQuote(markdown: string): string {
  return [EXPANDABLE_QUOTE_MARK, ...markdown.split('\n')].map((line) => (line ? `> ${line}` : '>')).join('\n');
}

/** A quote's text (its `>` taken off) without the mark when it is a folded one; null when it is not. */
export function expandableQuoteBody(quoteText: string): string | null {
  const text = quoteText.replace(/\r\n?/g, '\n');
  const [first, ...rest] = text.split('\n');
  return first.trim() === EXPANDABLE_QUOTE_MARK ? rest.join('\n') : null;
}
