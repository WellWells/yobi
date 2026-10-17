import { findMatches, type FindOptions } from './findMatches';
import { REVEAL_EVENT } from '../components/chat/CollapsibleContent';
import { releaseFollow } from '../hooks/useStickToBottom';

/**
 * Find in the open conversation, on the rendered page.
 *
 * Only text inside `[data-find-scope]` counts — the title, each prompt, each answer and its
 * translation — so the provider names, badges, buttons and the find bar's own input never match; a
 * scope that is not rendered (`display: none`) is skipped. Inside a scope the
 * KaTeX MathML copy (a formula would match twice), diagrams, buttons and anything marked
 * `data-find-omit` (a code block's language label) are skipped.
 *
 * Every turn is on the page (the conversation is not virtualised), so searching the DOM sees all
 * of it. If the list is ever virtualised, matches must move to the data and the DOM only locate them.
 */

const SCOPE = '[data-find-scope]';
// The last: an answer's opening block a post card stands for, hidden (the card is searched instead).
const OMIT = '[data-find-omit], .katex-mathml, svg, button, textarea, style, script, [data-post-card] > p:first-child';
const BLOCK = 'p, li, td, th, h1, h2, h3, h4, h5, h6, pre, blockquote, dt, dd, summary, figcaption';

export const HIGHLIGHT_ALL = 'yobi-find';
export const HIGHLIGHT_CURRENT = 'yobi-find-current';

interface Piece {
  node: Text;
  /** Offset of the node's first character in the joined scope text. */
  start: number;
}

/** A scope's text as one string, so a match can cross inline markup (`**Kyo**to`) but never a paragraph break. */
function joinScope(scope: Element): { text: string; pieces: Piece[] } {
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest(OMIT) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const pieces: Piece[] = [];
  let text = '';
  let block: Element | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const textNode = node as Text;
    const nodeBlock = textNode.parentElement?.closest(BLOCK) ?? null;
    if (pieces.length > 0 && nodeBlock !== block) text += '\n';
    block = nodeBlock;
    pieces.push({ node: textNode, start: text.length });
    text += textNode.data;
  }
  return { text, pieces };
}

function locate(pieces: Piece[], offset: number, atEnd: boolean): { node: Text; offset: number } {
  let lo = 0;
  let hi = pieces.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    // An end offset that lands exactly between two nodes belongs to the earlier one.
    const startsAfter = atEnd ? pieces[mid].start >= offset : pieces[mid].start > offset;
    if (startsAfter) hi = mid - 1;
    else lo = mid;
  }
  const piece = pieces[lo];
  return { node: piece.node, offset: offset - piece.start };
}

export function collectMatches(root: Element, query: string, options: FindOptions): Range[] {
  if (!query) return [];
  const ranges: Range[] = [];
  for (const scope of root.querySelectorAll(SCOPE)) {
    // A scope nested in another is walked by its parent.
    if (scope.parentElement?.closest(SCOPE)) continue;
    // Not on screen (an answer hidden behind "translation only"): a match there could not be shown.
    if (typeof scope.checkVisibility === 'function' && !scope.checkVisibility()) continue;
    const { text, pieces } = joinScope(scope);
    if (pieces.length === 0) continue;
    for (const [start, end] of findMatches(text, query, options)) {
      const from = locate(pieces, start, false);
      const to = locate(pieces, end, true);
      const range = document.createRange();
      range.setStart(from.node, from.offset);
      range.setEnd(to.node, to.offset);
      ranges.push(range);
    }
  }
  return ranges;
}

function highlightsSupported(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';
}

/** Paints every match and, on top, the current one. No DOM is touched, so React never re-renders for it. */
export function paintMatches(ranges: Range[], current: number): void {
  if (!highlightsSupported()) return;
  CSS.highlights.set(HIGHLIGHT_ALL, new Highlight(...ranges));
  const active = ranges[current];
  if (!active) {
    CSS.highlights.delete(HIGHLIGHT_CURRENT);
    return;
  }
  const highlight = new Highlight(active);
  highlight.priority = 1;
  CSS.highlights.set(HIGHLIGHT_CURRENT, highlight);
}

export function clearMatches(): void {
  if (!highlightsSupported()) return;
  CSS.highlights.delete(HIGHLIGHT_ALL);
  CSS.highlights.delete(HIGHLIGHT_CURRENT);
}

/** Opens what hides the match: a collapsed long prompt, a closed `<details>`. True when anything opened. */
function revealAncestors(range: Range, container: Element): boolean {
  let opened = false;
  for (let element = range.startContainer.parentElement; element && element !== container; element = element.parentElement) {
    if (element.hasAttribute('data-clamped')) {
      element.dispatchEvent(new Event(REVEAL_EVENT));
      opened = true;
    }
    if (element instanceof HTMLDetailsElement && !element.open) {
      element.open = true;
      opened = true;
    }
  }
  return opened;
}

/** Share of the view above the current match, so the lines before it show too. */
const MATCH_VIEW_OFFSET = 1 / 3;
const EDGE_MARGIN_PX = 48;

function scrollToRange(range: Range, container: HTMLElement): void {
  // Wide tables and code scroll sideways inside the page; bring the match in there first.
  for (let element = range.startContainer.parentElement; element && element !== container; element = element.parentElement) {
    if (element.scrollWidth <= element.clientWidth + 1) continue;
    const overflowX = getComputedStyle(element).overflowX;
    if (overflowX !== 'auto' && overflowX !== 'scroll') continue;
    const box = element.getBoundingClientRect();
    const rect = range.getBoundingClientRect();
    if (rect.left < box.left || rect.right > box.right) {
      element.scrollLeft += rect.left - box.left - box.width / 2;
    }
  }
  const view = container.getBoundingClientRect();
  const rect = range.getBoundingClientRect();
  if (rect.top >= view.top + EDGE_MARGIN_PX && rect.bottom <= view.bottom - EDGE_MARGIN_PX) return;
  container.scrollTop += rect.top - view.top - view.height * MATCH_VIEW_OFFSET;
}

/**
 * Brings a match into view. The conversation stops sticking to the bottom first, or a formula
 * finishing its render would pull the view back down.
 */
export function revealMatch(range: Range, container: HTMLElement): void {
  releaseFollow(range.startContainer.parentElement);
  if (!revealAncestors(range, container)) {
    scrollToRange(range, container);
    return;
  }
  // The expanded prompt lays out on the next frame.
  requestAnimationFrame(() => requestAnimationFrame(() => scrollToRange(range, container)));
}
