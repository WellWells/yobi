import { notionToDisplay, type NotionDisplayLabels } from '../../../../shared/notion/notionDisplay';
import { splitNotionBlocks, unspaceNotionBlocks } from '../../../../shared/notion/notionBlocks';
import type { NotionPendingChange } from '../../../../shared/notion/notionSyncTypes';
import { useI18nStore } from '../../store/i18nStore';
import { visibleSkeleton } from '../../utils/markdownBlocks';
import { NOT_SOURCE } from '../../utils/selectionSnapshot';

/*
 * Finding Notion text on the rendered page. The page is drawn from the Markdown, so a passage is
 * found by the characters it shows (whitespace aside), counted the way the selection tools count
 * them: formulas, diagrams, code labels and Yobi's own cards are not the source's characters.
 */

export function displayLabels(): NotionDisplayLabels {
  return { unsupported: useI18nStore.getState().t('notion.block.unsupported') };
}

/**
 * The characters a passage shows on the page. Each line's indentation comes off first: a nested
 * item on its own starts with a tab, which Markdown would read as a code block and show its "**".
 */
export function shownChars(written: string, labels: NotionDisplayLabels = displayLabels()): string {
  const flat = written.split('\n').map((line) => line.replace(/^[ \t]+/, '')).join('\n');
  return visibleSkeleton(notionToDisplay(flat, labels)).chars;
}

export interface PageChars {
  /** Every visible character of the page but whitespace, in order. */
  chars: string;
  /** Where each of them is in the DOM. */
  points: Array<{ node: Text; offset: number }>;
}

export function pageChars(scope: HTMLElement): PageChars {
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest(NOT_SOURCE) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let chars = '';
  const points: PageChars['points'] = [];
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const value = node.data;
    for (let i = 0; i < value.length; i++) {
      if (/\s/.test(value[i])) continue;
      chars += value[i];
      points.push({ node, offset: i });
    }
  }
  return { chars, points };
}

export interface CharSpan {
  from: number;
  /** Exclusive. */
  to: number;
}

/**
 * Where each block's characters sit among the page's, walking both in order: a block is looked for
 * only after the one before it, so text repeated earlier on the page is never taken for it. A block
 * that shows nothing, or is drawn differently from its text, is null and does not move the walk.
 */
export function alignBlocks(page: string, blocks: readonly string[]): Array<CharSpan | null> {
  let cursor = 0;
  return blocks.map((chars) => {
    if (!chars) return null;
    const at = page.indexOf(chars, cursor);
    if (at < 0) return null;
    cursor = at + chars.length;
    return { from: at, to: cursor };
  });
}

export function rangeOf(page: PageChars, span: CharSpan): Range | null {
  const start = page.points[span.from];
  const end = page.points[span.to - 1];
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  return range;
}

/** The document's rendered body: the text the page shows, not the editor or a card. */
export function documentScope(container: HTMLElement | null): HTMLElement | null {
  return container?.querySelector<HTMLElement>('[data-find-scope]') ?? null;
}

/**
 * A passage on the page, by its characters. Its start is enough to find it, and survives a formula
 * or a chart further on; the range runs as long as the passage.
 */
export function findPassage(container: HTMLElement | null, written: string): Range | null {
  const scope = documentScope(container);
  const needle = shownChars(written);
  if (!scope || !needle) return null;
  const page = pageChars(scope);
  const probe = [needle.slice(0, 80), needle.slice(0, 24)].find((part) => part && page.chars.includes(part));
  if (!probe) return null;
  const from = page.chars.indexOf(probe);
  return rangeOf(page, { from, to: Math.min(page.chars.length, from + needle.length) });
}

/** One local change found on the page. A removal has no text there: it is the edge of a neighbour. */
export interface ChangeSpot {
  change: NotionPendingChange;
  range: Range;
  /** Where the change is: the range itself, or just after / before it for a removal. */
  edge: 'whole' | 'after' | 'before';
}

/** The local changes as places on the rendered page; a change whose blocks are not found is left out. */
export function locateChanges(scope: HTMLElement, body: string, changes: readonly NotionPendingChange[]): ChangeSpot[] {
  if (changes.length === 0) return [];
  const labels = displayLabels();
  const page = pageChars(scope);
  // The blocks exactly as main numbered them (`notionDocStatus`): split again after the blank lines go.
  const blocks = splitNotionBlocks(unspaceNotionBlocks(body));
  const spans = alignBlocks(page.chars, blocks.map((block) => shownChars(block.text, labels)));
  const spots: ChangeSpot[] = [];
  for (const change of changes) {
    if (change.localEnd > change.localStart) {
      const found = spans.slice(change.localStart, change.localEnd).filter((span): span is CharSpan => span !== null);
      const range = found.length ? rangeOf(page, { from: found[0].from, to: found[found.length - 1].to }) : null;
      if (range) spots.push({ change, range, edge: 'whole' });
      continue;
    }
    const previous = spans[change.localStart - 1];
    const next = spans[change.localStart];
    const range = previous ? rangeOf(page, previous) : next ? rangeOf(page, next) : null;
    if (range) spots.push({ change, range, edge: previous ? 'after' : 'before' });
  }
  return spots;
}

function highlightsSupported(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';
}

/** Marks `range` under the highlight `name`, or clears it. */
export function setHighlight(name: string, range: Range | null): void {
  if (!highlightsSupported()) return;
  if (range) CSS.highlights.set(name, new Highlight(range));
  else CSS.highlights.delete(name);
}
