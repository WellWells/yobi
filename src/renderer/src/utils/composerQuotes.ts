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
