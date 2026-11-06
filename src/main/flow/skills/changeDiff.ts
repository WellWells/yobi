import { diffLines, diffRows } from '../../../shared/lineDiff';

/**
 * What changed between two captures of a watched text (a whole page, usually), written compactly
 * enough to hand to a model: "- old" / "+ new" lines with a little context, "@@" between changes
 * far apart. No prose, so the format needs no translation.
 */

export const ON_CHANGE_DIFF_MAX_CHARS = 8_000;
export const ON_CHANGE_DIFF_LINE_MAX_CHARS = 400;
export const ON_CHANGE_DIFF_CONTEXT = 2;
/** About 16 MB of transient table; past it the diff falls back to a line multiset. */
export const ON_CHANGE_DIFF_MAX_CELLS = 4_000_000;
/** Page text often arrives as a few huge lines; longer lines are split at sentence ends first. */
export const ON_CHANGE_SPLIT_LINE_CHARS = 300;
/** Characters kept on each side of the part of a long line that actually changed. */
export const ON_CHANGE_PAIR_CONTEXT_CHARS = 80;

const ELLIPSIS = '…';
const FOLD = '@@';

export interface CompactDiff {
  text: string;
  added: number;
  removed: number;
  truncated: boolean;
}

/**
 * Line endings, spacing within and around each line and blank lines vary between fetches of the
 * same page (a redeploy re-indents markup, an empty ad slot comes and goes), so they are folded
 * away before comparing. Blank lines go entirely: the diff ignores them, so a capture that differs
 * only by one must hash the same, or the step would pass the page through with an empty diff.
 */
export function normalizeWatchedText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
}

const SENTENCE_END = /(?<=[。！？；!?;])|(?<=\.)\s+/;

/** Long lines become one line per sentence, so edits in different sentences land on different lines. */
function splitForDiff(text: string): string {
  return text
    .split('\n')
    .flatMap((line) => {
      if (line.length <= ON_CHANGE_SPLIT_LINE_CHARS) return [line];
      const parts = line.split(SENTENCE_END).map((part) => part.trim()).filter(Boolean);
      return parts.length > 0 ? parts : [line];
    })
    .join('\n');
}

/**
 * Both sides (normalised) are the same lines once long lines are split at sentence ends, so only
 * spacing the split trims differs. A diff with no "-" or "+" line is not enough: past the line
 * table's cap it compares line counts only, and lines that merely moved would read as the same.
 */
export function sameDiffLines(before: string, after: string): boolean {
  return splitForDiff(before) === splitForDiff(after);
}

function isBlank(line: string | null): boolean {
  return line === null || line.trim() === '';
}

function capLine(line: string): string {
  return line.length > ON_CHANGE_DIFF_LINE_MAX_CHARS ? `${line.slice(0, ON_CHANGE_DIFF_LINE_MAX_CHARS)}${ELLIPSIS}` : line;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * A long line and the line that replaced it, cut down to the part that differs plus a little
 * context on each side; capping the line start instead would hide a change deep inside it.
 */
function pairWindow(before: string, after: string): [string, string] {
  if (Math.max(before.length, after.length) <= ON_CHANGE_DIFF_LINE_MAX_CHARS) return [before, after];
  const limit = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < limit && before[prefix] === after[prefix]) prefix += 1;
  if (prefix > 0 && isHighSurrogate(before.charCodeAt(prefix - 1))) prefix -= 1;
  let suffix = 0;
  while (
    suffix < limit - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix += 1;
  if (suffix > 0 && isHighSurrogate(before.charCodeAt(before.length - suffix - 1))) suffix -= 1;
  const start = Math.max(0, prefix - ON_CHANGE_PAIR_CONTEXT_CHARS);
  const cut = (line: string): string => {
    const end = Math.min(line.length, line.length - suffix + ON_CHANGE_PAIR_CONTEXT_CHARS);
    const body = line.slice(start, end);
    const head = start > 0 ? ELLIPSIS : '';
    if (body.length > ON_CHANGE_DIFF_LINE_MAX_CHARS) return `${head}${capLine(body)}`;
    return `${head}${body}${end < line.length ? ELLIPSIS : ''}`;
  };
  return [cut(before), cut(after)];
}

/** Without a line table: every line one side has more often than the other, in its own order. */
function multisetLines(before: string[], after: string[]): { removed: string[]; added: string[] } {
  const surplus = (from: string[], against: string[]): string[] => {
    const left = new Map<string, number>();
    for (const line of against) left.set(line, (left.get(line) ?? 0) + 1);
    const out: string[] = [];
    for (const line of from) {
      const count = left.get(line) ?? 0;
      if (count > 0) left.set(line, count - 1);
      else if (!isBlank(line)) out.push(line);
    }
    return out;
  };
  return { removed: surplus(before, after), added: surplus(after, before) };
}

/** Removed and added lines alternate, so a truncated list still shows both sides. */
function interleave(removed: string[], added: string[]): string[] {
  const lines: string[] = [];
  for (let k = 0; k < Math.max(removed.length, added.length); k++) {
    if (k < removed.length) lines.push(`- ${capLine(removed[k])}`);
    if (k < added.length) lines.push(`+ ${capLine(added[k])}`);
  }
  return lines;
}

function changedLines(before: string, after: string, maxCells: number): { lines: string[]; added: number; removed: number } {
  const ops = diffLines(before, after, maxCells);
  if (!ops) {
    const { removed, added } = multisetLines(before.split('\n'), after.split('\n'));
    return { lines: [FOLD, ...interleave(removed, added)], added: added.length, removed: removed.length };
  }
  // A blank line added or removed is not a change: dropped before context is chosen, or it would
  // leave hunks of context lines with nothing changed in them.
  const shown = ops.filter((op) => op.kind === 'same' || !isBlank(op.text));
  const added = shown.filter((op) => op.kind === 'added').length;
  const removed = shown.filter((op) => op.kind === 'removed').length;
  const lines: string[] = [];
  for (const row of diffRows(shown, ON_CHANGE_DIFF_CONTEXT)) {
    if (row.kind === 'fold') {
      if (lines.at(-1) !== FOLD) lines.push(FOLD);
    } else if (row.kind === 'same') {
      lines.push(`  ${capLine(row.text)}`.trimEnd());
    } else if (!isBlank(row.before) && !isBlank(row.after)) {
      const [was, now] = pairWindow(row.before!, row.after!);
      lines.push(`- ${was}`, `+ ${now}`);
    } else if (!isBlank(row.before)) {
      lines.push(`- ${capLine(row.before!)}`);
    } else if (!isBlank(row.after)) {
      lines.push(`+ ${capLine(row.after!)}`);
    }
  }
  return { lines, added, removed };
}

/** Both sides are expected normalised (`normalizeWatchedText`). */
export function compactLineDiff(
  before: string,
  after: string,
  maxChars = ON_CHANGE_DIFF_MAX_CHARS,
  maxCells = ON_CHANGE_DIFF_MAX_CELLS,
): CompactDiff {
  const { lines, added, removed } = changedLines(splitForDiff(before), splitForDiff(after), maxCells);
  if (added === 0 && removed === 0) return { text: '', added, removed, truncated: false };
  const whole = lines.join('\n');
  if (whole.length <= maxChars) return { text: whole, added, removed, truncated: false };
  const kept: string[] = [];
  let length = 0;
  // Room is kept for the "\n…" marker, so a truncated diff still fits in maxChars.
  const budget = maxChars - (ELLIPSIS.length + 1);
  for (const line of lines) {
    const next = length + (kept.length > 0 ? 1 : 0) + line.length;
    if (next > budget) break;
    kept.push(line);
    length = next;
  }
  kept.push(ELLIPSIS);
  return { text: kept.join('\n'), added, removed, truncated: true };
}
