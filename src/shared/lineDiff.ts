/**
 * What changed between two versions of a text, line by line. The middle that differs is compared
 * with a longest-common-subsequence table, which grows with the product of the two line counts, so
 * past a cap there is no diff at all rather than a slow or wrong one.
 */

export interface LineOp {
  kind: 'same' | 'removed' | 'added';
  text: string;
}

/** About 8 MB of table; a conversation rewritten end to end at a few thousand lines still fits. */
export const LINE_DIFF_MAX_CELLS = 2_000_000;

function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

/** Equal lines share a number, so the table compares integers rather than strings. */
function numberLines(a: readonly string[], b: readonly string[]): [Int32Array, Int32Array] {
  const ids = new Map<string, number>();
  const idOf = (line: string): number => {
    let id = ids.get(line);
    if (id === undefined) {
      id = ids.size;
      ids.set(line, id);
    }
    return id;
  };
  return [Int32Array.from(a, idOf), Int32Array.from(b, idOf)];
}

export function diffLines(before: string, after: string, maxCells: number = LINE_DIFF_MAX_CELLS): LineOp[] | null {
  const a = splitLines(before);
  const b = splitLines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;
  if ((n + 1) * (m + 1) > maxCells) return null;

  const ops: LineOp[] = a.slice(0, start).map((text) => ({ kind: 'same', text }));
  const [x, y] = numberLines(midA, midB);
  const width = m + 1;
  // lcs[i * width + j]: the longest common run of midA[i..] and midB[j..].
  const lcs = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] = x[i] === y[j]
        ? lcs[(i + 1) * width + j + 1] + 1
        : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      ops.push({ kind: 'same', text: midA[i] });
      i += 1;
      j += 1;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      ops.push({ kind: 'removed', text: midA[i] });
      i += 1;
    } else {
      ops.push({ kind: 'added', text: midB[j] });
      j += 1;
    }
  }
  for (; i < n; i++) ops.push({ kind: 'removed', text: midA[i] });
  for (; j < m; j++) ops.push({ kind: 'added', text: midB[j] });
  for (const text of a.slice(endA)) ops.push({ kind: 'same', text });
  return ops;
}

/**
 * A row of the diff as it is shown: a kept line, a removed line and the added line that took its
 * place (so the two can be compared word by word), a lone removal or addition, or a run of kept
 * lines folded into a count.
 */
export type DiffRow =
  | { kind: 'same'; text: string }
  | { kind: 'change'; before: string | null; after: string | null }
  | { kind: 'fold'; count: number };

/**
 * The diff with only `context` kept lines around each change; each run of removals is paired, in
 * order, with the run of additions right after it.
 */
export function diffRows(ops: readonly LineOp[], context = 2): DiffRow[] {
  const rows: DiffRow[] = [];
  let index = 0;
  const changed = ops.map((op) => op.kind !== 'same');
  const nearChange = (at: number): boolean => {
    for (let k = Math.max(0, at - context); k <= Math.min(ops.length - 1, at + context); k++) {
      if (changed[k]) return true;
    }
    return false;
  };
  while (index < ops.length) {
    const op = ops[index];
    if (op.kind === 'same') {
      if (nearChange(index)) {
        rows.push({ kind: 'same', text: op.text });
        index += 1;
        continue;
      }
      let count = 0;
      while (index < ops.length && ops[index].kind === 'same' && !nearChange(index)) {
        count += 1;
        index += 1;
      }
      rows.push({ kind: 'fold', count });
      continue;
    }
    const removed: string[] = [];
    const added: string[] = [];
    while (index < ops.length && ops[index].kind === 'removed') removed.push(ops[index++].text);
    while (index < ops.length && ops[index].kind === 'added') added.push(ops[index++].text);
    for (let k = 0; k < Math.max(removed.length, added.length); k++) {
      rows.push({ kind: 'change', before: removed[k] ?? null, after: added[k] ?? null });
    }
  }
  return rows;
}
