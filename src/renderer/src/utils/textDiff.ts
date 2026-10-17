/**
 * What changed between a passage and its rewrite, word by word (and character by character for
 * scripts written without spaces), so a reader can see at a glance whether the meaning moved.
 */

export interface DiffPart {
  kind: 'same' | 'removed' | 'added';
  text: string;
}

/** Larger inputs skip the diff: the table it needs grows with the product of the two lengths. */
const MAX_CELLS = 400_000;

const TOKEN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}_]+|\s+|[^\s\p{L}\p{N}_]/gu;

export function diffTokens(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

function push(parts: DiffPart[], kind: DiffPart['kind'], text: string): void {
  const last = parts.at(-1);
  if (last?.kind === kind) last.text += text;
  else parts.push({ kind, text });
}

/** Short enough that, kept between two changes, it reads as noise rather than as text that stayed. */
function isSliver(text: string): boolean {
  return !/\n/.test(text) && diffTokens(text).length <= 2;
}

/**
 * Each change as one removal then one addition. A sliver kept between two changes is folded into
 * them: a character-by-character comparison otherwise keeps stray single characters, and marks
 * that alternate every character or two cannot be read.
 */
export function mergeChanges(parts: DiffPart[]): DiffPart[] {
  const merged: DiffPart[] = [];
  let removed = '';
  let added = '';
  const flush = (): void => {
    if (removed) merged.push({ kind: 'removed', text: removed });
    if (added) merged.push({ kind: 'added', text: added });
    removed = '';
    added = '';
  };
  parts.forEach((part, index) => {
    if (part.kind === 'removed') removed += part.text;
    else if (part.kind === 'added') added += part.text;
    else if ((removed || added) && index < parts.length - 1 && isSliver(part.text)) {
      removed += part.text;
      added += part.text;
    } else {
      flush();
      merged.push({ ...part });
    }
  });
  flush();
  return merged;
}

/** The two texts as runs of kept, removed and added text; null when they are too long to compare. */
export function diffText(before: string, after: string): DiffPart[] | null {
  const a = diffTokens(before);
  const b = diffTokens(after);
  if ((a.length + 1) * (b.length + 1) > MAX_CELLS) return null;

  // Longest common subsequence lengths, from the end, so the walk below reads front to back.
  const width = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * width + j] = a[i] === b[j]
        ? lcs[(i + 1) * width + j + 1] + 1
        : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }

  const parts: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(parts, 'same', a[i]);
      i++;
      j++;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      push(parts, 'removed', a[i++]);
    } else {
      push(parts, 'added', b[j++]);
    }
  }
  while (i < a.length) push(parts, 'removed', a[i++]);
  while (j < b.length) push(parts, 'added', b[j++]);
  return mergeChanges(parts);
}
