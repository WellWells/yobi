import { closesFence, parseFenceOpen } from './markdownFences';
import type { FenceOpen } from './markdownFences';
import { markdownProse } from './markdownTitle';

const OMITTED = '\n[…]\n';
const MAX_BLOCKS = 9;

/** Ordered positions covering both ends and the interior without favouring the opening. */
export function samplePositions(length: number, count: number): number[] {
  const size = Math.min(length, count);
  return Array.from({ length: size }, (_, i) => size === 1 ? 0 : Math.round(i * (length - 1) / (size - 1)));
}

/** Long passages retain beginning, middle and end; omissions are explicit and Unicode-safe. */
export function sampleText(text: string, budget: number): string {
  const chars = Array.from(text.trim());
  if (chars.length <= budget) return chars.join('');
  if (budget < 30) return chars.slice(0, Math.max(0, budget)).join('');
  const size = Math.floor((budget - 2 * OMITTED.length) / 3);
  return [0, Math.floor((chars.length - size) / 2), chars.length - size]
    .map((start) => chars.slice(start, start + size).join('').trim())
    .join(OMITTED);
}

/** Content blocks without headings or hidden comments; code remains useful naming evidence. */
function contentBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  let lines: string[] = [];
  let fence: FenceOpen | null = null;
  function flush(code = false): void {
    const raw = lines.join('\n').trim();
    const text = code ? raw : markdownProse(raw, raw.length);
    if (text) blocks.push(text);
    lines = [];
  }
  for (const line of markdown.replace(/<!--[\s\S]*?(?:-->|$)/g, '').split('\n')) {
    if (fence) {
      if (closesFence(line, fence)) {
        flush(true);
        fence = null;
      } else lines.push(line);
      continue;
    }
    const opened = parseFenceOpen(line);
    if (opened) {
      flush();
      fence = opened;
    } else if (!line.trim() || /^ {0,3}#{1,6}\s/.test(line)) flush();
    else lines.push(line);
  }
  flush(fence !== null);
  return [...new Set(blocks)];
}

/** A fixed budget shared across content blocks, regardless of the number of Markdown headings. */
export function nameExcerpt(markdown: string, budget: number): string {
  if (budget <= 0) return '';
  const blocks = contentBlocks(markdown);
  if (blocks.join('\n').length <= budget) return blocks.join('\n');
  const positions = samplePositions(blocks.length, Math.min(MAX_BLOCKS, Math.max(1, Math.floor(budget / 120))));
  const perBlock = Math.floor((budget - Math.max(0, positions.length - 1) * OMITTED.length) / positions.length);
  return positions.map((index) => sampleText(blocks[index], perBlock)).join(OMITTED);
}
