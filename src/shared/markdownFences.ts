const FENCE_RE = /^(?:```|~~~)/;

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
