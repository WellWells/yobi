import { notionBlockRanges, type NotionBlockKind } from '../../../shared/notion/notionBlocks';
import { notionToDisplay, type NotionDisplayLabels } from '../../../shared/notion/notionDisplay';
import {
  locateSelection, visibleSkeleton, widenToSpans, type BlockKind, type MarkdownBlock, type SelectionHint, type Skeleton, type SourceRange,
} from './markdownBlocks';

const KINDS: Record<NotionBlockKind, BlockKind> = {
  text: 'paragraph',
  list: 'list',
  code: 'code',
  container: 'html',
  locked: 'locked',
  empty: 'other',
};

/** Whether `range` of a Notion document's text reaches into a block that is edited in Notion. */
export function touchesLockedBlock(text: string, range: { start: number; end: number }): boolean {
  return notionEditorBlocks(text).some((block) => block.kind === 'locked'
    && block.start < Math.max(range.end, range.start + 1) && range.start < block.end);
}

/**
 * A Notion document's text as the paragraph editor's blocks: Notion's own blocks (a callout is one,
 * whatever blank lines its code holds), a run of list items as one list, the way it reads.
 */
export function notionEditorBlocks(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  for (const range of notionBlockRanges(text)) {
    const kind = KINDS[range.kind];
    const last = blocks.at(-1);
    if (kind === 'list' && last?.kind === 'list' && text.slice(last.end, range.start) === '\n') {
      last.end = range.end;
      continue;
    }
    blocks.push({ start: range.start, end: range.end, kind });
  }
  return blocks;
}

/** Past this many comparisons a block's characters are left untied (its selections do not resolve). */
const ALIGN_CELLS_MAX = 4_000_000;

/**
 * For each character of `shown`, the index of the same character in `raw` (-1 when it has none),
 * as the longest common subsequence pairs them: `raw` is the block as written, with characters
 * the page does not show ("****" where Notion joins two bold runs), and the page has a few the
 * source does not (a citation's arrow, a mention's "@").
 */
function alignChars(shown: string, raw: string): number[] {
  const tied = new Array<number>(shown.length).fill(-1);
  let head = 0;
  while (head < shown.length && head < raw.length && shown[head] === raw[head]) {
    tied[head] = head;
    head += 1;
  }
  let tail = 0;
  while (tail < shown.length - head && tail < raw.length - head && shown[shown.length - 1 - tail] === raw[raw.length - 1 - tail]) {
    tied[shown.length - 1 - tail] = raw.length - 1 - tail;
    tail += 1;
  }
  const a = shown.slice(head, shown.length - tail);
  const b = raw.slice(head, raw.length - tail);
  if (!a || !b || a.length * b.length > ALIGN_CELLS_MAX) return tied;
  // Lengths of the common subsequence of each pair of suffixes; the shorter side is at most 2,000
  // characters under the cap, so the counts fit 16 bits.
  const width = b.length + 1;
  const table = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] = a[i] === b[j]
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      tied[head + i] = head + j;
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return tied;
}

const NOTION_TAG = /<(\/?)([a-z][a-z_-]*)(?:\s[^<>]*)?\/?>/gi;

/** Each tag of the text, and each element from its opening tag to its closing one. */
function notionTags(text: string): { tags: SourceRange[]; elements: SourceRange[] } {
  const tags: SourceRange[] = [];
  const elements: SourceRange[] = [];
  const open: Array<{ name: string; start: number }> = [];
  for (const match of text.matchAll(NOTION_TAG)) {
    const start = match.index;
    const end = start + match[0].length;
    tags.push({ start, end });
    const name = match[2]!.toLowerCase();
    if (match[0].endsWith('/>')) continue;
    if (!match[1]) {
      open.push({ name, start });
      continue;
    }
    const at = open.map((tag) => tag.name).lastIndexOf(name);
    if (at < 0) continue;
    elements.push({ start: open[at]!.start, end });
    open.length = at;
  }
  return { tags, elements };
}

/**
 * The range holding the whole of each element it reaches into — half of
 * "<mention-user …>Bob</mention-user>" replaced would leave a stray tag — or null when an end
 * still falls inside a tag.
 */
function wholeElements(text: string, range: SourceRange): SourceRange | null {
  const { tags, elements } = notionTags(text);
  const grown = widenToSpans(elements, range);
  const inside = (at: number): boolean => tags.some((tag) => at > tag.start && at < tag.end);
  return inside(grown.start) || inside(grown.end) ? null : grown;
}

/**
 * Where in a Notion document's text the selected text came from (see `locateSelection`). The page
 * shows the text through `notionToDisplay`, so the characters to look in are the page's, block by
 * block, each tied back to the block as written; matching the written text alone fails on what
 * the display tidies away — "**`mount`**** (mount a file system)**" shows no asterisks.
 */
export function locateNotionSelection(text: string, selected: string, hint: SelectionHint, labels: NotionDisplayLabels): SourceRange | null {
  const shown: Skeleton = { chars: '', offsets: [] };
  for (const block of notionBlockRanges(text)) {
    const raw = visibleSkeleton(block.text);
    const page = visibleSkeleton(notionToDisplay(block.text, labels));
    const tied = alignChars(page.chars, raw.chars);
    shown.chars += page.chars;
    for (const at of tied) shown.offsets.push(at < 0 || raw.offsets[at]! < 0 ? -1 : block.start + raw.offsets[at]!);
  }
  const range = locateSelection(text, selected, hint, shown);
  return range && wholeElements(text, range);
}

export type SelectionLocator = (source: string, selected: string, hint: SelectionHint) => SourceRange | null;

/** How a selection on the page is traced back to the text: through the display, in a Notion document. */
export function selectionLocator(notion: boolean, t: (key: string) => string): SelectionLocator {
  if (!notion) return locateSelection;
  const labels = { unsupported: t('notion.block.unsupported') };
  return (source, selected, hint) => locateNotionSelection(source, selected, hint, labels);
}
