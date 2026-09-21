/**
 * Rejoins GFM table rows that a provider split across physical lines.
 *
 * Every AI web UI serialises a multi-line table cell as `<br>`, and some of them
 * also wrap the row itself — occasionally with a blank line in the middle. GFM
 * parses one row per physical line, so the row ends at the wrap and every later
 * row falls out of the table and renders as a paragraph of pipes. Rejoining the
 * row before the parser sees it is the only place that damage can be undone.
 *
 * The repair only engages on the closed-pipe style, where the delimiter row ends
 * with `|`. That is the signal that every row is meant to end with `|` too, so a
 * row that does not is provably truncated. Tables written in the open style
 * (`| --- | ---`) are legal without trailing pipes and are left untouched.
 */

const MAX_ROW_LOOKAHEAD = 20;
const MAX_FENCE_INDENT = 3;
const MIN_FENCE_LENGTH = 3;
const HEADING_RE = /^ {0,3}#{1,6}(\s|$)/;
const TRAILING_BR_RE = /<br\s*\/?>$/i;
const LEADING_BR_RE = /^<br\s*\/?>/i;

interface Fence {
  marker: string;
  length: number;
}

function parseFenceOpen(line: string): Fence | null {
  const indent = line.length - line.trimStart().length;
  if (indent > MAX_FENCE_INDENT) return null;
  const marker = line[indent];
  if (marker !== '`' && marker !== '~') return null;
  let length = 0;
  while (line[indent + length] === marker) length += 1;
  if (length < MIN_FENCE_LENGTH) return null;
  if (marker === '`' && line.slice(indent + length).includes('`')) return null;
  return { marker, length };
}

function closesFence(line: string, open: Fence): boolean {
  const indent = line.length - line.trimStart().length;
  if (indent > MAX_FENCE_INDENT) return false;
  let length = 0;
  while (line[indent + length] === open.marker) length += 1;
  if (length < open.length) return false;
  return line.slice(indent + length).trim() === '';
}

/** Splits on pipes that are not escaped, so a `\|` inside a cell never ends it. */
function splitCells(row: string): string[] {
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    if (char === '\\' && i + 1 < row.length) {
      current += char + row[i + 1];
      i += 1;
      continue;
    }
    if (char === '|') {
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

function isPipeRow(line: string): boolean {
  return splitCells(line).length > 1;
}

function endsWithPipe(line: string): boolean {
  const cells = splitCells(line.trimEnd());
  return cells.length > 1 && cells[cells.length - 1] === '';
}

function isDelimiterRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('-') || !/^[|\s:-]+$/.test(trimmed)) return false;
  const cells = splitCells(trimmed);
  const from = cells[0].trim() === '' ? 1 : 0;
  const to = cells[cells.length - 1].trim() === '' ? cells.length - 1 : cells.length;
  const inner = cells.slice(from, to);
  return inner.length > 0 && inner.every((cell) => /^:?-+:?$/.test(cell.trim()));
}

/**
 * Joins a wrapped row back onto its head. A seam between two `<br>` tags keeps
 * one of them — that pair is the wrap artifact, not a blank line the author
 * asked for — and any other seam gets the single space a soft break would have
 * rendered as.
 */
function mergeSeam(head: string, tail: string): string {
  if (!TRAILING_BR_RE.test(head)) return `${head} ${tail}`;
  return head + tail.replace(LEADING_BR_RE, '');
}

interface JoinedRow {
  text: string;
  next: number;
}

/**
 * `stopBeforeNewTable` separates the two callers. A body row must never absorb
 * the header of the next table — it also ends with `|`, so it looks exactly like
 * the missing tail. A wrapped header, on the other hand, is only ever confirmed
 * BY the delimiter row that follows it, so that same shape is its proof.
 */
function joinSplitRow(lines: string[], start: number, stopBeforeNewTable: boolean): JoinedRow | null {
  let text = lines[start].trimEnd();
  let index = start + 1;
  let scanned = 0;
  while (index < lines.length && scanned < MAX_ROW_LOOKAHEAD) {
    const candidate = lines[index];
    scanned += 1;
    index += 1;
    if (candidate.trim() === '') continue;
    // A fence, a heading or a delimiter row opens a block of its own: the row was
    // never going to close, so leave the whole run exactly as the author wrote it.
    if (parseFenceOpen(candidate) || isDelimiterRow(candidate) || HEADING_RE.test(candidate)) return null;
    if (stopBeforeNewTable && index < lines.length && isDelimiterRow(lines[index]) && endsWithPipe(lines[index])) {
      return null;
    }
    text = mergeSeam(text, candidate.trimStart());
    if (endsWithPipe(text)) return { text, next: index };
  }
  return null;
}

interface TableHead {
  text: string;
  delimiter: number;
}

function tableHeadAt(lines: string[], index: number): TableHead | null {
  const line = lines[index];
  if (!isPipeRow(line)) return null;

  const closedDelimiter = (at: number): boolean =>
    at < lines.length && isDelimiterRow(lines[at]) && endsWithPipe(lines[at]);

  if (endsWithPipe(line)) {
    return closedDelimiter(index + 1) ? { text: line, delimiter: index + 1 } : null;
  }

  // A wrapped header only counts once the delimiter row confirms a table follows.
  const joined = joinSplitRow(lines, index, false);
  if (!joined || !closedDelimiter(joined.next)) return null;
  return { text: joined.text, delimiter: joined.next };
}

function collectBody(lines: string[], start: number, out: string[]): number {
  let index = start;
  while (index < lines.length) {
    const row = lines[index];
    if (row.trim() === '' || !isPipeRow(row) || parseFenceOpen(row)) break;
    if (endsWithPipe(row)) {
      out.push(row);
      index += 1;
      continue;
    }
    const joined = joinSplitRow(lines, index, true);
    if (!joined) {
      out.push(row);
      index += 1;
      continue;
    }
    out.push(joined.text);
    index = joined.next;
  }
  return index;
}

export function repairSplitTableRows(markdown: string): string {
  if (!markdown.includes('|')) return markdown;
  const lines = markdown.split('\n');
  const out: string[] = [];
  let fence: Fence | null = null;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (fence) {
      out.push(line);
      if (closesFence(line, fence)) fence = null;
      index += 1;
      continue;
    }

    const open = parseFenceOpen(line);
    if (open) {
      out.push(line);
      fence = open;
      index += 1;
      continue;
    }

    const head = tableHeadAt(lines, index);
    if (head) {
      out.push(head.text, lines[head.delimiter]);
      index = collectBody(lines, head.delimiter + 1, out);
      continue;
    }

    out.push(line);
    index += 1;
  }

  return out.join('\n');
}
