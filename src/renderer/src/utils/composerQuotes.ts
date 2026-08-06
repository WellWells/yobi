/**
 * A passage quoted out of an answer travels as a markdown blockquote in front of the
 * message. It is prepended to the *payload* rather than to the composer's raw text, so
 * that `/search …` still parses as a command and the user never sees the `>` syntax.
 */

export function buildQuotePrefix(quotes: readonly string[]): string {
  return quotes
    .map((quote) => quote.trim())
    .filter(Boolean)
    .map((quote) => quote.split('\n').map((line) => `> ${line}`.trimEnd()).join('\n'))
    .join('\n\n');
}

export function withQuotedContext(quotes: readonly string[], message: string): string {
  const prefix = buildQuotePrefix(quotes);
  return prefix ? `${prefix}\n\n${message}` : message;
}

export interface SplitPrompt {
  quotes: string[];
  message: string;
}

/**
 * The inverse, for display. A sent turn is stored as markdown, so the bubbles that print
 * prompts as plain text would otherwise show the `>` characters the composer took care to
 * hide. Splitting them back out lets the transcript render the quote as a quote.
 *
 * Only leading blockquote lines count: a `>` further down belongs to the message the user
 * wrote and is left alone.
 */
export function splitQuotedPrompt(prompt: string): SplitPrompt {
  const lines = prompt.split('\n');
  const quotes: string[] = [];
  let block: string[] = [];
  let index = 0;

  const flush = (): void => {
    if (block.length === 0) return;
    const text = block.join('\n').trim();
    if (text) quotes.push(text);
    block = [];
  };

  while (index < lines.length) {
    const line = lines[index];
    if (line.startsWith('>')) {
      block.push(line.replace(/^>\s?/, ''));
      index += 1;
      continue;
    }
    // A blank line closes the block; the next `>` after it opens the following one.
    if (line.trim() === '' && block.length > 0) {
      flush();
      index += 1;
      continue;
    }
    break;
  }
  flush();

  return { quotes, message: lines.slice(index).join('\n').trim() };
}
