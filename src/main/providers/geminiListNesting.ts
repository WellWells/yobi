import { closesFence, parseFenceOpen, type FenceOpen } from '../../shared/markdownFences';

/**
 * One entry of a list as the page renders it, in document order: a list item, or a further block
 * (second paragraph, code, table, quote) of the item at that depth. The top level is depth 1.
 */
export interface ListMark {
  item: boolean;
  depth: number;
}

type LineRole = 'blank' | 'marker' | 'text' | 'fenced';

const QUOTE_PREFIX_RE = /^(?:> ?)*/;
const LIST_MARKER_RE = /^(?:[*+-]|\d{1,9}[.)]) +/;

function quotePrefix(line: string): string {
  return QUOTE_PREFIX_RE.exec(line)?.[0] ?? '';
}

/** `prefix` is the quote the list itself sits in; a quote inside an item is indented whole. */
function indented(line: string, columns: number, prefix: string): string {
  const start = line.startsWith(prefix) ? prefix.length : 0;
  return `${line.slice(0, start)}${' '.repeat(columns)}${line.slice(start)}`;
}

function afterPrefix(line: string, prefix: string): string {
  return line.startsWith(prefix) ? line.slice(prefix.length) : line;
}

/** A table's rows and a quote's lines are one block, however many lines it runs to. */
function sameBlock(previous: string, line: string): boolean {
  if (quotePrefix(previous) && quotePrefix(line)) return true;
  return previous.startsWith('|') && line.startsWith('|');
}

/** What each copied line is. A fence's opening line is `text`; everything after it is `fenced`. */
function lineRoles(lines: readonly string[]): LineRole[] {
  let fence: FenceOpen | null = null;
  let fencePrefix = '';
  return lines.map((line) => {
    if (fence) {
      if (closesFence(afterPrefix(line, fencePrefix), fence)) fence = null;
      return 'fenced';
    }
    const body = afterPrefix(line, quotePrefix(line));
    if (body.trim() === '') return 'blank';
    if (LIST_MARKER_RE.test(body)) return 'marker';
    fence = parseFenceOpen(body);
    fencePrefix = quotePrefix(line);
    return 'text';
  });
}

/**
 * Gemini's copy control drops every list's indentation, though the page renders the nesting. The
 * copied text keeps the Markdown and the page keeps the structure, so this indents the former by
 * the latter: list lines pair up with `outline`'s items in order, and an item's further blocks
 * move inside it. The pairing is all or nothing, because indenting by a wrong pairing would
 * invent a hierarchy the answer does not have; an outline that does not fit leaves the text as
 * copied.
 */
export function restoreListNesting(copied: string, outline: readonly ListMark[]): string {
  if (!outline.some((mark) => !mark.item || mark.depth > 1)) return copied;
  const lines = copied.split('\n');
  const roles = lineRoles(lines);
  const itemLines = roles.filter((role) => role === 'marker').length;
  if (itemLines !== outline.filter((mark) => mark.item).length) return copied;

  const out: string[] = [];
  // Index by depth: the column an item's own content starts at. Depth 0 is the page's margin.
  const contentColumn = [0];
  let next = 0;
  // The column of the block being written, while no blank line has ended it.
  let open: number | null = null;
  let fenceColumn = 0;
  let listPrefix = '';

  for (const [index, line] of lines.entries()) {
    const role = roles[index];
    if (role === 'fenced') {
      out.push(line.trim() === '' ? line : indented(line, fenceColumn, listPrefix));
    } else if (role === 'blank') {
      open = null;
      out.push(line);
    } else if (role === 'marker') {
      // A block the page has and the copy dropped must not hold up the items after it.
      while (!outline[next].item) next += 1;
      const { depth } = outline[next];
      next += 1;
      const column = contentColumn[depth - 1];
      listPrefix = quotePrefix(line);
      const marker = LIST_MARKER_RE.exec(line.slice(listPrefix.length))?.[0] ?? '';
      contentColumn[depth] = column + marker.length;
      open = contentColumn[depth];
      out.push(indented(line, column, listPrefix));
    } else {
      const mark = outline[next];
      const continues = open !== null && sameBlock(lines[index - 1], line);
      if (mark && !mark.item && !continues) {
        next += 1;
        open = contentColumn[mark.depth];
        if (out.length > 0 && out[out.length - 1].trim() !== '') out.push('');
      }
      fenceColumn = open ?? 0;
      out.push(indented(line, fenceColumn, listPrefix));
    }
  }
  return out.join('\n');
}
