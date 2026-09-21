import { MEMORY_CURATE_NOTE_MAX_CHARS } from '../../shared/memoryCurate';
import { cleanMemoryText } from '../../shared/userMemory';

/**
 * The lines a reply ends with to change the user's memory. Plain lines rather than a JSON field:
 * web-UI models wrap, fence and bold whatever they are given, and a line survives all three where
 * a JSON object does not. The same grammar serves chat and the agent's final answer.
 */
export type MemoryOp =
  | { kind: 'add'; text: string }
  | { kind: 'update'; id: string; text: string }
  | { kind: 'forget'; id: string }
  /** The user asked for the whole memory to be tidied: nothing changes until they confirm it. */
  | { kind: 'review'; text: string };

export interface ParsedMemoryReply {
  cleaned: string;
  ops: MemoryOp[];
}

/**
 * Square-bracket placeholders: an angle-bracket one reads as a tag, and tags in Yobi's prompts
 * mean "text someone else wrote". The brackets also match how entries are listed (`[m3] …`),
 * which the parser accepts back.
 */
export const MEMORY_LINE_SYNTAX = 'memory_add: [short sentence] / memory_update: [id] = [new sentence] / memory_forget: [id]';
export const MEMORY_REVIEW_SYNTAX = 'memory_review: [what to tidy]';

const FENCE_RE = /^\s*(```|~~~)/;
const KEY_RE = /^memory\\?_(add|update|forget|review)\s*[:：]\s*(.*)$/i;
const ID_RE = /\bm\d+\b/gi;
const UPDATE_RE = /^\[?(m\d+)\]?\s*(?:=|＝|->|→|:|：)\s*(.+)$/i;
const RULE_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

/** Bold, code ticks and a list or quote marker are the ways a model decorates a line it was told to write plainly. */
function normalizeLine(line: string): string {
  return line
    .trim()
    .replace(/\*\*|__/g, '')
    .replace(/`/g, '')
    .replace(/^(?:[-*+•>]\s*)+/, '')
    .trim();
}

/** The syntax shows the sentence as `[short sentence]`, and a model sometimes keeps the brackets. */
function sentence(raw: string): string {
  const text = cleanMemoryText(raw);
  return /^\[[^[\]]*\]$/.test(text) ? cleanMemoryText(text.slice(1, -1)) : text;
}

function parseLine(line: string): MemoryOp[] | null {
  const match = KEY_RE.exec(normalizeLine(line));
  if (!match) return null;
  const kind = match[1].toLowerCase();
  const rest = match[2].trim();
  if (kind === 'add') {
    const text = sentence(rest);
    return text ? [{ kind: 'add', text }] : [];
  }
  if (kind === 'update') {
    const update = UPDATE_RE.exec(rest);
    if (!update) return [];
    const text = sentence(update[2]);
    return text ? [{ kind: 'update', id: update[1].toLowerCase(), text }] : [];
  }
  if (kind === 'review') return [{ kind: 'review', text: sentence(rest).slice(0, MEMORY_CURATE_NOTE_MAX_CHARS) }];
  return [...new Set((rest.match(ID_RE) ?? []).map((id) => id.toLowerCase()))]
    .map((id) => ({ kind: 'forget' as const, id }));
}

function isMemoryLine(line: string): boolean {
  return parseLine(line) !== null;
}

/**
 * Takes the memory lines out of a reply. A line inside a code block is left alone — the user may
 * have asked for exactly that text — unless the block holds nothing but memory lines, which is a
 * model fencing its own markers.
 */
export function parseMemoryReply(reply: string): ParsedMemoryReply {
  const lines = (reply ?? '').split(/\r?\n/);
  const kept: string[] = [];
  const ops: MemoryOp[] = [];
  // Counted apart from `ops`: a malformed memory line changes nothing but must still come out.
  let removed = 0;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (FENCE_RE.test(line)) {
      const fence = FENCE_RE.exec(line)?.[1] ?? '```';
      let close = index + 1;
      while (close < lines.length && !lines[close].trim().startsWith(fence)) close += 1;
      const body = lines.slice(index + 1, close);
      const filled = body.filter((entry) => entry.trim());
      if (filled.length > 0 && filled.every(isMemoryLine)) {
        for (const entry of filled) ops.push(...(parseLine(entry) ?? []));
        removed += filled.length;
      } else {
        kept.push(...lines.slice(index, Math.min(close + 1, lines.length)));
      }
      index = close + 1;
      continue;
    }
    const parsed = parseLine(line);
    if (parsed) {
      ops.push(...parsed);
      removed += 1;
    } else {
      kept.push(line);
    }
    index += 1;
  }
  if (removed === 0) return { cleaned: reply, ops };
  // A rule the model drew above its memory lines is left dangling once they are gone.
  while (kept.length > 0 && (!kept[kept.length - 1].trim() || RULE_RE.test(kept[kept.length - 1]))) kept.pop();
  const cleaned = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { cleaned, ops };
}
