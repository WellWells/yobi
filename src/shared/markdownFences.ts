const FENCE_RE = /^(?:```|~~~)/;

/** A fence indented further than this is indented code, not a fence. */
export const MAX_FENCE_INDENT = 3;
const MIN_FENCE_LENGTH = 3;

export interface FenceOpen {
  marker: string;
  length: number;
  /** Leading whitespace characters before the marker run. */
  indent: number;
  /** Everything after the marker run, untrimmed. */
  info: string;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * A CommonMark fence opener: up to three columns of indent, then three or more backticks or
 * tildes, and no backtick in a backtick fence's info string.
 *
 * Indentation is every leading whitespace character, one column each (tab, NBSP and U+3000
 * included), not spaces only. None of the callers tracks list-container indentation, and a fence
 * indented with a tab inside a list item is real code to micromark: math promotion and table
 * repair must leave it alone. The price is that a top-level tab-indented "fence", which CommonMark
 * reads as indented code, is treated as a fence too — the cautious direction for both callers.
 * A caller that must reproduce the parser's code body byte for byte (mermaid pre-rendering)
 * screens out other leading whitespace before asking.
 */
export function parseFenceOpen(line: string): FenceOpen | null {
  const indent = indentOf(line);
  if (indent > MAX_FENCE_INDENT) return null;
  const marker = line[indent];
  if (marker !== '`' && marker !== '~') return null;
  let length = 0;
  while (line[indent + length] === marker) length += 1;
  if (length < MIN_FENCE_LENGTH) return null;
  const info = line.slice(indent + length);
  if (marker === '`' && info.includes('`')) return null;
  return { marker, length, indent, info };
}

/** Whether `line` closes the fence `open` started: the same marker, at least as long, nothing after. */
export function closesFence(line: string, open: Pick<FenceOpen, 'marker' | 'length'>): boolean {
  const indent = indentOf(line);
  if (indent > MAX_FENCE_INDENT) return false;
  let length = 0;
  while (line[indent + length] === open.marker) length += 1;
  if (length < open.length) return false;
  return line.slice(indent + length).trim() === '';
}

/**
 * Marks the lines that sit inside a fenced code block. A fence that is never closed does not
 * count as one: a turn marker quoted inside a real code block must stay quoted, but an answer
 * that opens a fence and never closes it must not swallow every turn written after it.
 */
export function fencedLines(lines: string[]): boolean[] {
  const fenced = new Array<boolean>(lines.length).fill(false);
  let openerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const isFence = FENCE_RE.test(lines[i].trim());
    if (openerIndex < 0) {
      if (isFence) {
        openerIndex = i;
        fenced[i] = true;
      }
      continue;
    }
    fenced[i] = true;
    if (isFence) openerIndex = -1;
  }
  // The last fence was never closed, so it opened nothing.
  if (openerIndex >= 0) {
    for (let i = openerIndex; i < lines.length; i++) fenced[i] = false;
  }
  return fenced;
}
