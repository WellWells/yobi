/**
 * A subtitle file as the source text plus the spans of it that hold words. Translating replaces
 * those spans and copies everything else byte for byte, so numbers, time codes, styles and line
 * endings cannot change. This is not `normalizeCues` (flow/skills/srt.ts), which merges and retimes
 * captions Yobi made itself.
 */
import * as path from 'node:path';

/** block = cues under a time line (SRT, WebVTT, SBV); ass = Dialogue lines; lrc = stamped lines. */
export type SubtitleKind = 'block' | 'ass' | 'lrc';

const KINDS: Readonly<Record<string, SubtitleKind>> = {
  '.srt': 'block', '.vtt': 'block', '.sbv': 'block', '.ass': 'ass', '.ssa': 'ass', '.lrc': 'lrc',
};

export const SUBTITLE_EXTENSIONS: readonly string[] = Object.keys(KINDS);

export function subtitleKind(file: string): SubtitleKind | null {
  return KINDS[path.extname(file).toLowerCase()] ?? null;
}

export interface SubtitleSpan {
  start: number;
  end: number;
  /** What stays around the translation: a position tag, a tag around the whole cue, a dialogue dash. */
  prefix: string;
  text: string;
  suffix: string;
}

export interface SubtitleDocument {
  source: string;
  spans: SubtitleSpan[];
  /** How this format puts a second line in a cue. */
  lineBreak: string;
}

interface SourceLine {
  start: number;
  end: number;
  text: string;
}

const CUE_TIME = String.raw`(?:\d{1,3}:)?\d{1,2}:\d{2}[,.]\d{1,3}`;
const TIME_LINE = new RegExp(String.raw`^\s*${CUE_TIME}\s*(?:-->|,)\s*${CUE_TIME}`);
const LEADING_OVERRIDE = /^(?:\s|\{\\[^}]*\})+/;
/** A tag around the whole cue. Only that is kept: one around a word could not be placed in a translation. */
const WRAPPED = /^(<(i|b|u|font)\b[^>]*>)((?:(?!<\/?\2\b)[\s\S])*)(<\/\2>)$/i;
const MARKUP = /<\/?(?:i|b|u|s|c|v|font|ruby|rt|lang)\b[^>]*>|<\d{1,2}:[^>]*>|\{\\[^}]*\}/gi;
const DASH = /^[-–—]+\s*/;
const LRC_STAMPS = /^(?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+/;
const ASS_DEFAULT_FIELDS = 10;

function sourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  const ending = /\r\n|\n|\r/g;
  let at = 0;
  for (let match = ending.exec(source); match; match = ending.exec(source)) {
    lines.push({ start: at, end: match.index, text: source.slice(at, match.index) });
    at = ending.lastIndex;
  }
  lines.push({ start: at, end: source.length, text: source.slice(at) });
  return lines;
}

function plainText(text: string): string {
  return text.replace(MARKUP, '').replace(/\s+/g, ' ').trim();
}

/** Music notes around the words. An engine moves them into the line, so they are not sent. */
function aroundNotes(text: string): { lead: string; words: string; trail: string } {
  const lead = /^(?:[♪♫]\s*)+/.exec(text)?.[0] ?? '';
  const trail = /(?:\s*[♪♫])+$/.exec(text.slice(lead.length))?.[0] ?? '';
  const words = text.slice(lead.length, text.length - trail.length);
  return words ? { lead, words, trail } : { lead: '', words: text, trail: '' };
}

function markedSpan(source: string, start: number, end: number): SubtitleSpan | null {
  const raw = source.slice(start, end);
  const override = LEADING_OVERRIDE.exec(raw)?.[0] ?? '';
  const rest = raw.slice(override.length).trim();
  const wrapped = WRAPPED.exec(rest);
  const plain = plainText(wrapped ? wrapped[3] : rest);
  const dash = DASH.exec(plain)?.[0] ?? '';
  const { lead, words, trail } = aroundNotes(plain.slice(dash.length));
  if (!words) return null;
  return { start, end, prefix: `${override.trim()}${wrapped?.[1] ?? ''}${dash}${lead}`, text: words, suffix: `${trail}${wrapped?.[4] ?? ''}` };
}

/**
 * A dash starts a speaker; a line without one goes on with the speaker before it. A leading dash
 * alone often marks a change of speaker from the cue before, so it does not split the cue.
 */
function speakerTurns(lines: readonly SourceLine[]): SourceLine[][] {
  const turns: SourceLine[][] = [];
  for (const line of lines) {
    const turn = turns.at(-1);
    if (turn && !DASH.test(plainText(line.text))) turn.push(line);
    else turns.push([line]);
  }
  return turns;
}

/** Each speaker's lines go as one span, one sentence broken over lines included. */
function cueSpans(source: string, lines: readonly SourceLine[]): SubtitleSpan[] {
  return speakerTurns(lines).flatMap((turn) => markedSpan(source, turn[0].start, turn[turn.length - 1].end) ?? []);
}

function isCueNumber(lines: readonly SourceLine[], i: number): boolean {
  return /^\s*\d+\s*$/.test(lines[i].text) && TIME_LINE.test(lines[i + 1]?.text ?? '');
}

function blockSpans(source: string): SubtitleSpan[] {
  const lines = sourceLines(source);
  const spans: SubtitleSpan[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!TIME_LINE.test(lines[i].text)) continue;
    let last = i + 1;
    while (last < lines.length && lines[last].text.trim() && !TIME_LINE.test(lines[last].text) && !isCueNumber(lines, last)) last++;
    spans.push(...cueSpans(source, lines.slice(i + 1, last)));
    i = last - 1;
  }
  return spans;
}

/** Where the Text field starts: after as many commas as there are fields before it. */
function assTextOffset(line: string, fields: number): number {
  let at = -1;
  for (let comma = 0; comma < fields - 1; comma++) {
    at = line.indexOf(',', at + 1);
    if (at < 0) return -1;
  }
  return at + 1;
}

function assSpans(source: string): SubtitleSpan[] {
  const spans: SubtitleSpan[] = [];
  let inEvents = false;
  let fields = ASS_DEFAULT_FIELDS;
  for (const line of sourceLines(source)) {
    const trimmed = line.text.trim();
    if (trimmed.startsWith('[')) inEvents = /^\[events\]/i.test(trimmed);
    if (!inEvents) continue;
    if (/^format\s*:/i.test(trimmed)) fields = trimmed.split(',').length;
    if (!/^dialogue\s*:/i.test(trimmed)) continue;
    const offset = assTextOffset(line.text, fields);
    if (offset < 0) continue;
    const start = line.start + offset;
    const raw = source.slice(start, line.end);
    if (/\\p[1-9]/.test(raw)) continue; // A drawing, not words.
    const lead = /^(?:\{[^}]*\})*/.exec(raw)?.[0] ?? '';
    const text = raw.slice(lead.length).replace(/\{[^}]*\}/g, '').replace(/\\[Nnh]/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) spans.push({ start, end: line.end, prefix: lead, text, suffix: '' });
  }
  return spans;
}

function lrcSpans(source: string): SubtitleSpan[] {
  return sourceLines(source).flatMap((line) => {
    const stamps = LRC_STAMPS.exec(line.text)?.[0];
    return stamps ? markedSpan(source, line.start + stamps.length, line.end) ?? [] : [];
  });
}

export function parseSubtitle(kind: SubtitleKind, source: string): SubtitleDocument {
  if (kind === 'ass') return { source, spans: assSpans(source), lineBreak: '\\N' };
  if (kind === 'lrc') return { source, spans: lrcSpans(source), lineBreak: ' / ' };
  return { source, spans: blockSpans(source), lineBreak: /\r\n|\n|\r/.exec(source)?.[0] ?? '\n' };
}

/** The file with each span's words replaced. `bilingual` adds the original under each translation. */
export function renderSubtitle(doc: SubtitleDocument, translated: readonly string[], bilingual = false): string {
  let out = '';
  let at = 0;
  doc.spans.forEach((span, i) => {
    const wrap = (text: string): string => `${span.prefix}${text}${span.suffix}`;
    const both = bilingual && translated[i] !== span.text;
    out += doc.source.slice(at, span.start) + wrap(translated[i]) + (both ? `${doc.lineBreak}${wrap(span.text)}` : '');
    at = span.end;
  });
  return out + doc.source.slice(at);
}

/** A file this share of non-ASCII bytes or less is Western text with curly quotes, not CJK. */
const WESTERN_HIGH_BYTES = 0.02;

/**
 * The file's text, or null when it is in a legacy multi-byte encoding. Big5, GBK and Shift-JIS can
 * all decode each other's bytes without an error, so those are refused rather than guessed.
 */
export function decodeSubtitle(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    const high = bytes.reduce((count, byte) => count + (byte >= 0x80 ? 1 : 0), 0);
    return high <= bytes.length * WESTERN_HIGH_BYTES ? new TextDecoder('windows-1252').decode(bytes) : null;
  }
}
