import { diffText, type DiffPart } from './textDiff';

/*
 * A before/after comparison shown as it reads: both sides rendered, the changed words marked on
 * the rendered text with the CSS Custom Highlight API (the DOM is left alone, as find does). The
 * text compared is what the reader sees, so Markdown syntax never shows up as a change.
 */

export type DiffSide = 'removed' | 'added';

const HIGHLIGHT_NAMES: Record<DiffSide, string> = { removed: 'yobi-diff-removed', added: 'yobi-diff-added' };

/** Not part of the visible text: formula source copies, diagrams, code-block labels. */
const SKIP = '.katex-mathml, svg, [data-find-omit]';
const BLOCK = 'p, li, h1, h2, h3, h4, h5, h6, td, th, pre, blockquote, summary, dt, dd';

interface TextSpan {
  node: Text;
  /** Where the node's text starts in `text`. */
  start: number;
}

export interface VisibleText {
  text: string;
  spans: TextSpan[];
}

/** The visible text under `root`, a newline between blocks so words of two paragraphs never merge. */
export function visibleText(root: HTMLElement): VisibleText {
  // Only what is skipped inside the box counts: the box itself may sit in something find leaves out.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const skipped = node.parentElement?.closest(SKIP);
      return skipped && root.contains(skipped) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  let text = '';
  const spans: TextSpan[] = [];
  let lastBlock: Element | null = null;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const block = node.parentElement?.closest(BLOCK) ?? null;
    if (text && block !== lastBlock && !text.endsWith('\n')) text += '\n';
    lastBlock = block;
    spans.push({ node, start: text.length });
    text += node.data;
  }
  return { text, spans };
}

/** DOM ranges covering `[from, to)` of a `visibleText`, one per text node it crosses. */
export function rangesFor(index: VisibleText, from: number, to: number): Range[] {
  const ranges: Range[] = [];
  for (const { node, start } of index.spans) {
    const end = start + node.data.length;
    if (end <= from || start >= to) continue;
    const range = document.createRange();
    range.setStart(node, Math.max(from, start) - start);
    range.setEnd(node, Math.min(to, end) - start);
    if (!range.collapsed && range.toString().trim()) ranges.push(range);
  }
  return ranges;
}

/** Which ranges of each side changed, from the word diff of the two visible texts. */
export function changedRanges(before: VisibleText | null, after: VisibleText | null): Record<DiffSide, Range[]> {
  const result: Record<DiffSide, Range[]> = { removed: [], added: [] };
  const parts: DiffPart[] | null = diffText(before?.text ?? '', after?.text ?? '');
  if (!parts) return result;
  let atBefore = 0;
  let atAfter = 0;
  for (const part of parts) {
    if (part.kind === 'same') {
      atBefore += part.text.length;
      atAfter += part.text.length;
    } else if (part.kind === 'removed') {
      if (before) result.removed.push(...rangesFor(before, atBefore, atBefore + part.text.length));
      atBefore += part.text.length;
    } else {
      if (after) result.added.push(...rangesFor(after, atAfter, atAfter + part.text.length));
      atAfter += part.text.length;
    }
  }
  return result;
}

/** Every comparison on screen adds its ranges under its own key; the two highlights hold them all. */
const registry: Record<DiffSide, Map<string, Range[]>> = { removed: new Map(), added: new Map() };

function supported(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';
}

function publish(side: DiffSide): void {
  if (!supported()) return;
  const all = [...registry[side].values()].flat();
  if (all.length === 0) CSS.highlights.delete(HIGHLIGHT_NAMES[side]);
  else CSS.highlights.set(HIGHLIGHT_NAMES[side], new Highlight(...all));
}

export function setDiffHighlights(owner: string, ranges: Record<DiffSide, Range[]>): void {
  for (const side of ['removed', 'added'] as const) {
    if (ranges[side].length > 0) registry[side].set(owner, ranges[side]);
    else registry[side].delete(owner);
    publish(side);
  }
}

export function clearDiffHighlights(owner: string): void {
  for (const side of ['removed', 'added'] as const) {
    if (registry[side].delete(owner)) publish(side);
  }
}
