import { isMapsUrl } from './mapReviews';

export const MAX_QUESTION_CHARS = 500;

export interface MapsQuestion {
  url: string;
  question: string;
}

interface UrlSpan {
  url: string;
  start: number;
  end: number;
}

const URL_START = /https?:\/\//gi;
const TRAILING_URL_PUNCT = '.,;:!?)]}\'"';
const LEADING_SEPARATORS = /^[\s,，、;；:：\-–—>]+/;
const SPACE_BEFORE_PUNCT = /\s+(?=[.,;:!?，。、！？；：」』）】》〉])/g;

function isUrlChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return code > 0x20 && code < 0x7f;
}

function findUrls(text: string): UrlSpan[] {
  const spans: UrlSpan[] = [];
  for (const match of text.matchAll(URL_START)) {
    const start = match.index;
    const previous = spans.at(-1);
    if (previous && start < previous.end) continue;
    let end = start;
    while (end < text.length && isUrlChar(text[end])) end++;
    while (end > start && TRAILING_URL_PUNCT.includes(text[end - 1])) end--;
    spans.push({ url: text.slice(start, end), start, end });
  }
  return spans;
}

function tidyQuestion(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(SPACE_BEFORE_PUNCT, '')
    .trim()
    .replace(LEADING_SEPARATORS, '')
    .trim();
}

export function splitMapsQuestion(text: string): MapsQuestion | null {
  const spans = findUrls(text);
  if (spans.length !== 1) return null;
  const [span] = spans;
  if (!isMapsUrl(span.url)) return null;

  const question = tidyQuestion(`${text.slice(0, span.start)} ${text.slice(span.end)}`);
  if (!/[\p{L}\p{N}]/u.test(question)) return null;
  if (question.length > MAX_QUESTION_CHARS) return null;
  return { url: span.url, question };
}
