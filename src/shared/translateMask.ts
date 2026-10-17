import { codeSpans, mathSpans, type TextSpan } from './inlineMathDelimiters';
import { fencedLines } from './markdownFences';

/**
 * Translation masking: what must come back exactly as written — code, formulas, web addresses,
 * footnote markers — is swapped for numbered `{{n}}` placeholders before the text is sent, and put
 * back afterwards. A reply where any placeholder is missing, repeated or invented is not patched
 * together: the caller shows it as the model wrote it, flagged.
 */

export interface MaskedText {
  /** The text with placeholders. */
  text: string;
  /** The number of the first placeholder; `tokens[i]` is `{{first + i}}`. */
  first: number;
  tokens: string[];
}

export type UnmaskResult =
  | { ok: true; text: string }
  | { ok: false; text: string };

const URL_RE = /\b(?:https?:\/\/|mailto:)[^\s<>()[\]{}"'`]+/gi;
/** Punctuation that ends a sentence around an address rather than belonging to it. */
const URL_TAIL = /[.,;:!?。，、；：！？）」』]+$/;
const FOOTNOTE_RE = /\[\^[^\]\s]+\]/g;
/** Text that already looks like a placeholder is masked too, so it cannot be mistaken for one. */
const PLACEHOLDER_LIKE = /\{\{\s*\d+\s*\}\}/g;
const PLACEHOLDER_IN_REPLY = /\{\{\s*(\d+)\s*\}\}/g;

/** Spans in order, a later one dropped where it overlaps one already taken. */
function claim(taken: TextSpan[], candidates: TextSpan[]): TextSpan[] {
  const out = [...taken];
  for (const span of candidates) {
    if (span.end <= span.start) continue;
    if (out.some((other) => span.start < other.end && other.start < span.end)) continue;
    out.push(span);
  }
  return out;
}

function regexSpans(text: string, re: RegExp, trimTail?: RegExp): TextSpan[] {
  const spans: TextSpan[] = [];
  for (const match of text.matchAll(re)) {
    const value = trimTail ? match[0].replace(trimTail, '') : match[0];
    if (match.index !== undefined && value) spans.push({ start: match.index, end: match.index + value.length });
  }
  return spans;
}

/** Each closed fenced block, opener to closer, as one span: a code block travels as one placeholder. */
function fenceBlocks(text: string): TextSpan[] {
  const lines = text.split('\n');
  const fenced = fencedLines(lines);
  const spans: TextSpan[] = [];
  let offset = 0;
  let open: TextSpan | null = null;
  lines.forEach((line, index) => {
    if (fenced[index]) {
      if (open) open.end = offset + line.length;
      else open = { start: offset, end: offset + line.length };
    } else if (open) {
      spans.push(open);
      open = null;
    }
    offset += line.length + 1;
  });
  if (open) spans.push(open);
  return spans;
}

/** The text with everything that must survive word for word replaced by `{{n}}`, counting from `first`. */
export function maskTranslation(source: string, first = 1): MaskedText {
  let spans = claim([], fenceBlocks(source));
  spans = claim(spans, codeSpans(source));
  spans = claim(spans, mathSpans(source));
  spans = claim(spans, regexSpans(source, URL_RE, URL_TAIL));
  spans = claim(spans, regexSpans(source, FOOTNOTE_RE));
  spans = claim(spans, regexSpans(source, PLACEHOLDER_LIKE));
  spans.sort((a, b) => a.start - b.start);

  const tokens: string[] = [];
  let text = '';
  let copied = 0;
  for (const span of spans) {
    text += `${source.slice(copied, span.start)}{{${first + tokens.length}}}`;
    tokens.push(source.slice(span.start, span.end));
    copied = span.end;
  }
  return { text: text + source.slice(copied), first, tokens };
}

/**
 * The reply with each placeholder put back. Every one must appear exactly once, and none that was
 * never sent; otherwise the reply is returned as the model wrote it, with `ok: false`.
 */
export function unmaskTranslation(reply: string, masked: Pick<MaskedText, 'first' | 'tokens'>): UnmaskResult {
  const counts = new Map<number, number>();
  for (const match of reply.matchAll(PLACEHOLDER_IN_REPLY)) {
    const n = Number(match[1]);
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const last = masked.first + masked.tokens.length;
  const exact = masked.tokens.every((_, i) => counts.get(masked.first + i) === 1)
    && [...counts.keys()].every((n) => n >= masked.first && n < last);
  if (!exact) return { ok: false, text: reply };
  return {
    ok: true,
    text: reply.replace(PLACEHOLDER_IN_REPLY, (_, digits: string) => masked.tokens[Number(digits) - masked.first]),
  };
}

/** Parts sent together in one request, divided by a placeholder of their own. */
export interface MaskedParts {
  text: string;
  parts: MaskedText[];
  /** The placeholder numbers between parts, in order. */
  separators: number[];
}

/** Several texts in one request (a question and its answer), each masked, joined by a placeholder line. */
export function maskTranslationParts(sources: readonly string[]): MaskedParts {
  const parts: MaskedText[] = [];
  const separators: number[] = [];
  let next = 1;
  const pieces: string[] = [];
  sources.forEach((source, index) => {
    if (index > 0) {
      separators.push(next);
      pieces.push(`{{${next}}}`);
      next += 1;
    }
    const masked = maskTranslation(source, next);
    parts.push(masked);
    pieces.push(masked.text);
    next += masked.tokens.length;
  });
  return { text: pieces.join('\n\n'), parts, separators };
}

/**
 * Each part of the reply, unmasked on its own; null when the dividing placeholders did not come
 * back exactly once and in order, so the parts cannot be told apart.
 */
export function unmaskTranslationParts(reply: string, masked: MaskedParts): UnmaskResult[] | null {
  const pieces: string[] = [];
  let rest = reply;
  for (const separator of masked.separators) {
    const re = new RegExp(`\\{\\{\\s*${separator}\\s*\\}\\}`, 'g');
    const found = [...rest.matchAll(re)];
    if (found.length !== 1 || found[0].index === undefined) return null;
    if ([...reply.matchAll(re)].length !== 1) return null;
    pieces.push(rest.slice(0, found[0].index));
    rest = rest.slice(found[0].index + found[0][0].length);
  }
  pieces.push(rest);
  return pieces.map((piece, index) => {
    const result = unmaskTranslation(piece.trim(), masked.parts[index]);
    return { ...result, text: result.text.trim() };
  });
}
