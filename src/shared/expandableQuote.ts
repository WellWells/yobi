/**
 * A quote Telegram shows folded (`<blockquote expandable>`): a few lines and "show more". Markdown
 * has no way to say so, so the quote opens with a line of its own that the Telegram formatter reads
 * and drops. Written for a forwarded post's text and, in a bot's approval question, for the call's
 * arguments under the readable lines (Telegram's verbatim sender folds it as well; LINE unfolds it).
 */
export const EXPANDABLE_QUOTE_MARK = '[!EXPANDABLE]';

/** `markdown` as a folded quote: every line quoted, so a message cut short still ends inside it. */
export function expandableQuote(markdown: string): string {
  return [EXPANDABLE_QUOTE_MARK, ...markdown.split('\n')].map((line) => (line ? `> ${line}` : '>')).join('\n');
}

/**
 * The text with every folded quote opened up: the mark line gone and its lines without `>`, for a
 * channel that cannot fold (LINE) — the lines still show, only not tucked away. A code block is
 * left exactly as written: a shell command in one is what runs, and `> x` there is a redirect.
 */
export function unfoldExpandableQuotes(text: string): string {
  const out: string[] = [];
  const lines = text.split('\n');
  let inside = false;
  let fence: string | null = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (fence !== null) {
      if (line === fence) fence = null;
      out.push(line);
      continue;
    }
    if (/^`{3,}$/.test(line) && lines.indexOf(line, index + 1) > index) {
      inside = false;
      fence = line;
      out.push(line);
      continue;
    }
    if (line.startsWith('>') && line.replace(/^> ?/, '').trim() === EXPANDABLE_QUOTE_MARK) {
      inside = true;
      continue;
    }
    if (inside && line.startsWith('>')) {
      out.push(line.replace(/^> ?/, ''));
      continue;
    }
    inside = false;
    out.push(line);
  }
  return out.join('\n');
}

/** A quote's text (its `>` taken off) without the mark when it is a folded one; null when it is not. */
export function expandableQuoteBody(quoteText: string): string | null {
  const text = quoteText.replace(/\r\n?/g, '\n');
  const [first, ...rest] = text.split('\n');
  return first.trim() === EXPANDABLE_QUOTE_MARK ? rest.join('\n') : null;
}
