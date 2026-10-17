import type { SelectionHint } from './markdownBlocks';

/**
 * The selection in an answer, kept past the moment it is lost: typing a request into the writing
 * tools panel moves focus out of the answer and collapses the selection, but the rewrite still
 * has to know what was selected and where.
 */
export interface SelectionSnapshot {
  text: string;
  range: Range;
  turnIndex: number;
  /** The answer's rendered Markdown box. */
  answer: HTMLElement;
  /** The answer's top-level block holding the end of the selection; a result card goes after it. */
  anchor: HTMLElement;
  /** The anchor's index among the rendered blocks, and how many there are. */
  anchorBlock: { index: number; count: number };
  hint: SelectionHint;
}

const BLOCK_SELECTOR = 'p, li, blockquote, td, th, h1, h2, h3, h4, h5, h6, pre';
export const ANSWER_SELECTOR = '.md-response[data-find-scope]';

function elementOf(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

function topLevelChild(answer: HTMLElement, node: Node): HTMLElement | null {
  let element = elementOf(node);
  while (element && element.parentElement !== answer) element = element.parentElement;
  return element instanceof HTMLElement ? element : null;
}

function visibleLength(text: string): number {
  return text.replace(/\s+/g, '').length;
}

/**
 * What the page shows that the Markdown does not hold as text: formulas (KaTeX, MathML copy
 * included), diagrams, a code block's language label, a rewrite's result card. The source side
 * (`locateSelection`'s skeleton) leaves formulas and diagrams out too.
 */
export const NOT_SOURCE = '.katex, svg, [data-find-omit], [data-selection-ignore], button';

/** Visible characters of the answer before the selection, counted like the source's skeleton. */
function sourceLikeLengthBefore(answer: HTMLElement, range: Range): number {
  const walker = document.createTreeWalker(answer, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest(NOT_SOURCE) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let count = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (text === range.startContainer) return count + visibleLength(text.data.slice(0, range.startOffset));
    if (range.comparePoint(text, 0) >= 0) break;
    count += visibleLength(text.data);
  }
  return count;
}

/**
 * The anchor's position among the answer's rendered blocks: what the renderer emits per top-level
 * block, without the footnote section it adds at the end or anything Yobi placed between them.
 */
function renderedBlockIndex(answer: HTMLElement, anchor: HTMLElement): { index: number; count: number } {
  const blocks = [...answer.children].filter((child) => !child.matches('[data-selection-ignore], [data-find-omit], section.footnotes, .footnotes'));
  return { index: blocks.indexOf(anchor), count: blocks.length };
}

/** The current selection when it lies inside one answer; null anywhere else. */
export function snapshotAnswerSelection(selection: Selection | null = window.getSelection()): SelectionSnapshot | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const common = elementOf(range.commonAncestorContainer);
  const answer = common?.closest<HTMLElement>(ANSWER_SELECTOR) ?? null;
  if (!answer) return null;
  const turn = answer.closest('[data-turn-index]')?.getAttribute('data-turn-index');
  const turnIndex = turn ? Number.parseInt(turn, 10) : Number.NaN;
  const anchor = topLevelChild(answer, range.endContainer);
  const text = selection.toString();
  if (!Number.isInteger(turnIndex) || !anchor || !text.trim()) return null;

  const block = common?.closest(BLOCK_SELECTOR);
  return {
    text,
    range: range.cloneRange(),
    turnIndex,
    answer,
    anchor,
    anchorBlock: renderedBlockIndex(answer, anchor),
    hint: {
      ...(block && answer.contains(block) ? { context: block.textContent ?? '' } : {}),
      before: sourceLikeLengthBefore(answer, range),
    },
  };
}
