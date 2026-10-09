import { FENCE_RE, RULE_RE, isMemoryLine, normalizeLine } from '../memory/memoryProtocol';
import { cleanRecap } from '../../shared/recap';

/** `recap\_line` too: a model writing Markdown escapes the underscore the way it does `memory\_add`. */
const RECAP_RE = /^recap\\?_line\s*[:：]\s*(.*)$/i;

export interface ExtractedRecap {
  recap: string | null;
  body: string;
}

function recapContent(line: string): string | null {
  const match = RECAP_RE.exec(normalizeLine(line));
  return match ? match[1] : null;
}

function isProtocolLine(line: string): boolean {
  return recapContent(line) !== null || isMemoryLine(line);
}

/** The syntax shows the sentence as `[...]`, and a model sometimes keeps the brackets. */
function unbracket(text: string): string {
  const trimmed = text.trim();
  return /^\[[^[\]]*\]$/.test(trimmed) ? trimmed.slice(1, -1) : trimmed;
}

interface FenceBlock {
  start: number;
  /** Index of the closing fence line, or `lines.length` when the fence never closes. */
  end: number;
}

/** Same reading as `parseMemoryReply`: a fence closes at the next line starting with its marker. */
function fenceBlocks(lines: readonly string[]): FenceBlock[] {
  const blocks: FenceBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const fence = FENCE_RE.exec(lines[index])?.[1];
    if (!fence) {
      index += 1;
      continue;
    }
    let close = index + 1;
    while (close < lines.length && !lines[close].trim().startsWith(fence)) close += 1;
    blocks.push({ start: index, end: close });
    index = close + 1;
  }
  return blocks;
}

/**
 * Takes the recap line out of a reply. Only the reply's tail counts — the run of blank lines,
 * rules, memory lines and recap lines it ends with — so a `recap_line:` the user asked to see in
 * the middle of an answer stays where it is. A fence at the tail holding nothing but protocol lines
 * is the model fencing its own markers: the recap comes out of it, and the fence goes too once
 * nothing is left in it; the memory lines stay for the memory parser, which reads such a fence.
 */
export function extractRecapLine(reply: string): ExtractedRecap {
  const lines = (reply ?? '').split(/\r?\n/);
  const blocks = fenceBlocks(lines);
  const blockAt = (index: number): FenceBlock | undefined =>
    blocks.find((block) => index >= block.start && index <= block.end);

  const recapIndexes: number[] = [];
  const emptiedFences: FenceBlock[] = [];
  let index = lines.length - 1;
  while (index >= 0) {
    const block = blockAt(index);
    if (block) {
      // Ending inside a fence that never closes: everything after it is code.
      if (block.end >= lines.length) break;
      const inner = lines.slice(block.start + 1, block.end)
        .map((line, offset) => ({ line, at: block.start + 1 + offset }))
        .filter(({ line }) => line.trim());
      if (inner.length === 0 || !inner.every(({ line }) => isProtocolLine(line))) break;
      const recaps = inner.filter(({ line }) => recapContent(line) !== null);
      recapIndexes.push(...recaps.map(({ at }) => at));
      if (recaps.length === inner.length) emptiedFences.push(block);
      index = block.start - 1;
      continue;
    }
    const line = lines[index];
    if (!line.trim() || RULE_RE.test(line) || isMemoryLine(line)) {
      index -= 1;
      continue;
    }
    if (recapContent(line) === null) break;
    recapIndexes.push(index);
    index -= 1;
  }

  if (recapIndexes.length === 0) return { recap: null, body: reply };

  // The last one written wins, should a model write two.
  const newest = Math.max(...recapIndexes);
  const recap = cleanRecap(unbracket(recapContent(lines[newest]) ?? '')) || null;
  const drop = new Set(recapIndexes);
  for (const fence of emptiedFences) {
    for (let at = fence.start; at <= fence.end; at += 1) drop.add(at);
  }
  // A blank line the removal brought next to another one goes too; spacing elsewhere is the answer's.
  const kept: string[] = [];
  let dropped = false;
  lines.forEach((line, at) => {
    if (drop.has(at)) {
      dropped = true;
      return;
    }
    const doubled = dropped && !line.trim() && kept.length > 0 && !kept[kept.length - 1].trim();
    dropped = false;
    if (!doubled) kept.push(line);
  });
  // A rule the model drew above the line is left dangling once it is gone.
  while (kept.length > 0 && (!kept[kept.length - 1].trim() || RULE_RE.test(kept[kept.length - 1]))) kept.pop();
  const body = kept.join('\n');
  // A reply that was nothing but the line is kept as it came: an empty answer is worse than a stray line.
  if (!body.trim()) return { recap: null, body: reply };
  return { recap, body };
}
