import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { Nodes, Root, RootContent } from 'mdast';
import { isMermaidLanguage } from '../../../shared/mermaidFences';

/**
 * An answer's Markdown as top-level blocks, and the way back from what the reader selected on
 * screen to the Markdown that produced it.
 *
 * Offsets are JS string indices into the source, straight from the parser's positions. Parsing
 * uses the same GFM and math syntax the renderer does (`singleDollarTextMath: false`), so a block
 * here is a block on screen.
 */

export type BlockKind = 'paragraph' | 'heading' | 'list' | 'table' | 'code' | 'math' | 'blockquote'
  | 'html' | 'thematicBreak' | 'definition' | 'other'
  /** A Notion block Yobi does not edit (a table, a child page): it is edited in Notion. */
  | 'locked';

export interface MarkdownBlock {
  start: number;
  end: number;
  kind: BlockKind;
}

export interface SourceRange {
  start: number;
  end: number;
}

/** Where on the page the selection was, to tell two equal passages apart. */
export interface SelectionHint {
  /** Text of the paragraph (or cell, item) the selection sits in. */
  context?: string;
  /** Visible, non-whitespace characters in the answer before the selection. */
  before?: number;
}

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath, { singleDollarTextMath: false });

function parse(source: string): Root {
  return parser.parse(source) as Root;
}

function startOf(node: Nodes): number {
  return node.position?.start.offset ?? -1;
}

function endOf(node: Nodes): number {
  return node.position?.end.offset ?? -1;
}

function kindOf(node: RootContent): BlockKind {
  switch (node.type) {
    case 'paragraph':
    case 'heading':
    case 'list':
    case 'table':
    case 'code':
    case 'math':
    case 'blockquote':
    case 'html':
    case 'thematicBreak':
      return node.type;
    case 'definition':
    case 'footnoteDefinition':
      return 'definition';
    default:
      return 'other';
  }
}

const DETAILS_OPEN = /^<details>/i;
const DETAILS_CLOSE = /<\/details>/gi;

function detailsDepthChange(value: string): number {
  const opens = (value.match(/<details>/gi) ?? []).length;
  const closes = (value.match(DETAILS_CLOSE) ?? []).length;
  return opens - closes;
}

/**
 * Top-level blocks in source order. A `<details>` block is one block from its opening tag to its
 * matching close: the renderer pairs the two tags only when they arrive together, so a block that
 * holds one of them alone would render as stray tag text.
 */
export function splitMarkdownBlocks(source: string): MarkdownBlock[] {
  const nodes = parse(source).children.filter((node) => startOf(node) >= 0 && endOf(node) >= 0);
  const blocks: MarkdownBlock[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.type === 'html' && DETAILS_OPEN.test(node.value.trim())) {
      let depth = detailsDepthChange(node.value);
      let last = i;
      while (depth > 0 && last + 1 < nodes.length) {
        last++;
        const next = nodes[last];
        if (next.type === 'html') depth += detailsDepthChange(next.value);
      }
      if (depth <= 0 && last > i) {
        blocks.push({ start: startOf(node), end: endOf(nodes[last]), kind: 'html' });
        i = last;
        continue;
      }
    }
    blocks.push({ start: startOf(node), end: endOf(node), kind: kindOf(node) });
  }
  return blocks;
}

/**
 * Every link and footnote definition in the answer, so a block shown on its own still resolves
 * `[^1]` and `[text][ref]`. The renderer drops definitions nothing in the block refers to.
 */
export function definitionsSource(source: string, blocks: readonly MarkdownBlock[]): string {
  return blocks
    .filter((block) => block.kind === 'definition')
    .map((block) => source.slice(block.start, block.end))
    .join('\n\n');
}

/** The block holding `offset`, or the last one starting before it; -1 before the first. */
export function blockIndexAt(blocks: readonly MarkdownBlock[], offset: number): number {
  let found = -1;
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].start > offset) break;
    found = i;
  }
  return found;
}

/** The visible text of an answer without whitespace, each character tied to its source offset (-1: not in the source). */
export interface Skeleton {
  chars: string;
  offsets: number[];
}

const WHITESPACE = /\s/;
const ESCAPABLE = /[!-/:-@[-`{-~]/;
const TAG_ONLY = /^(?:<\/?[a-z][a-z0-9-]*(?:\s[^>]*)?\/?>|<!--[\s\S]*-->)$/i;
const FENCE_OPEN = /^(?:`{3,}|~{3,})/;
/** Fences the renderer may draw as a formula instead of code (`latexFenceMath`). */
const MATH_FENCE = /^(?:math|latex|tex)$/i;

/**
 * Ties each character of a parsed value to where it sits in the source. The value is the source
 * minus syntax (escapes, entities, fences), in order, so a forward scan finds every character; one
 * that cannot be found maps to -1 and the selection holding it does not resolve.
 */
function alignValue(source: string, value: string, from: number, to: number, skeleton: Skeleton): void {
  let cursor = from;
  for (const char of value) {
    if (WHITESPACE.test(char)) continue;
    const at = source.indexOf(char, cursor);
    const found = at >= 0 && at + char.length <= to;
    for (let unit = 0; unit < char.length; unit++) {
      skeleton.chars += char[unit];
      skeleton.offsets.push(found ? at + unit : -1);
    }
    if (found) cursor = at + char.length;
  }
}

function buildSkeleton(source: string, root: Root): Skeleton {
  const skeleton: Skeleton = { chars: '', offsets: [] };
  // GFM numbers footnotes by first reference, and that number is what the page shows.
  const footnoteNumbers = new Map<string, number>();

  const walk = (node: Nodes): void => {
    const start = startOf(node);
    const end = endOf(node);
    switch (node.type) {
      case 'text':
        alignValue(source, node.value, start, end, skeleton);
        return;
      case 'inlineCode':
        alignValue(source, node.value, start, end, skeleton);
        return;
      // The page shows a formula as KaTeX and a diagram as SVG, neither of them the source's
      // characters; the selection snapshot skips them too, so the two counts stay in step.
      case 'math':
      case 'inlineMath':
        return;
      case 'code': {
        if (isMermaidLanguage(node.lang ?? '') || MATH_FENCE.test(node.lang ?? '')) return;
        // Skip the opening fence line, or its info string ("ts") would claim the code's letters.
        const slice = source.slice(start, end);
        const bodyFrom = FENCE_OPEN.test(slice) ? start + slice.indexOf('\n') + 1 : start;
        alignValue(source, node.value, bodyFrom, end, skeleton);
        return;
      }
      case 'html':
        if (!TAG_ONLY.test(node.value.trim())) alignValue(source, node.value, start, end, skeleton);
        return;
      case 'footnoteReference': {
        const key = node.identifier;
        const number = footnoteNumbers.get(key) ?? footnoteNumbers.size + 1;
        footnoteNumbers.set(key, number);
        for (const char of String(number)) {
          skeleton.chars += char;
          skeleton.offsets.push(start);
        }
        return;
      }
      default:
        if ('children' in node) for (const child of node.children) walk(child as Nodes);
    }
  };
  walk(root);
  return skeleton;
}

/** The characters `source` shows on the page, without whitespace, each tied to where it sits in `source`. */
export function visibleSkeleton(source: string): Skeleton {
  return buildSkeleton(source, parse(source));
}

function occurrences(haystack: string, needle: string): number[] {
  const found: number[] = [];
  if (!needle) return found;
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) found.push(at);
  return found;
}

const INLINE_SPANS = new Set(['strong', 'emphasis', 'delete', 'link', 'linkReference', 'inlineCode', 'inlineMath', 'footnoteReference']);
/** The bare inline tags the renderer turns into elements (`remarkHtmlTags`); in the tree each is two `html` nodes. */
const PAIRED_TAG = /^<(kbd|sub|sup|mark|u|ins|s)>$/i;

/** Each whitelisted `<tag>` with its `</tag>` among the same parent's children, as one span. */
function pairedTagSpans(children: readonly Nodes[], spans: SourceRange[]): void {
  children.forEach((child, index) => {
    if (child.type !== 'html') return;
    const open = PAIRED_TAG.exec(child.value.trim());
    if (!open) return;
    const close = `</${open[1].toLowerCase()}>`;
    const match = children.slice(index + 1).find((next) => next.type === 'html' && next.value.trim().toLowerCase() === close);
    if (match) spans.push({ start: startOf(child), end: endOf(match) });
  });
}

/**
 * Widens a range that cuts through inline markup so it holds the whole of it: half of a bold run
 * replaced would leave a stray `**`, half of a `<kbd>` pair a stray tag. A range wholly inside the
 * markup is left alone, so the markup stays around the replacement.
 */
function expandInline(root: Root, range: SourceRange): SourceRange {
  const spans: SourceRange[] = [];
  const collect = (node: Nodes): void => {
    if (INLINE_SPANS.has(node.type)) spans.push({ start: startOf(node), end: endOf(node) });
    if ('children' in node) {
      pairedTagSpans(node.children as Nodes[], spans);
      for (const child of node.children) collect(child as Nodes);
    }
  };
  collect(root);
  return widenToSpans(spans, range);
}

/** The range grown until it cuts none of `spans`: each one it reaches into is taken whole. */
export function widenToSpans(spans: readonly SourceRange[], range: SourceRange): SourceRange {
  let { start, end } = range;
  let changed = true;
  while (changed) {
    changed = false;
    for (const span of spans) {
      const cutsStart = span.start < start && start < span.end && end > span.end;
      const cutsEnd = span.start < end && end < span.end && start < span.start;
      if (!cutsStart && !cutsEnd) continue;
      start = Math.min(start, span.start);
      end = Math.max(end, span.end);
      changed = true;
    }
  }
  return { start, end };
}

function pickCandidate(candidates: number[], skeleton: Skeleton, needleLength: number, hint: SelectionHint): number | null {
  let pool = candidates;
  const context = hint.context?.replace(/\s+/g, '') ?? '';
  if (pool.length > 1 && context.length >= needleLength) {
    const holders = occurrences(skeleton.chars, context);
    const inside = pool.filter((at) => holders.some((from) => from <= at && at + needleLength <= from + context.length));
    if (inside.length > 0) pool = inside;
  }
  if (pool.length === 1) return pool[0];
  const { before } = hint;
  if (typeof before !== 'number') return null;
  // The count can still drift from the source (a footnote's back link, an image's alt text), so the
  // nearest candidate only wins clearly: close to the count, and well closer than the runner-up.
  // Anything less is no answer — a replace in the wrong place is worse than none.
  const ranked = [...pool].sort((a, b) => Math.abs(a - before) - Math.abs(b - before));
  const best = Math.abs(ranked[0] - before);
  const next = Math.abs(ranked[1] - before);
  if (best > BEFORE_TOLERANCE || best * 2 >= next) return null;
  return ranked[0];
}

/** How far the page's character count may sit from the source's and still name a candidate. */
const BEFORE_TOLERANCE = 8;
const ENTITY = /^&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i;

/**
 * Where in the source the selected text came from, or null when it cannot be told for sure: the
 * text is not in the source as written (a rendered formula, a diagram) or it appears more than
 * once and the hint does not settle which. `shown` is what the page shows when that is not `source`
 * rendered as it is (a Notion document, see `locateNotionSelection`).
 */
export function locateSelection(source: string, selected: string, hint: SelectionHint = {}, shown?: Skeleton): SourceRange | null {
  const needle = selected.replace(/\s+/g, '');
  if (!needle) return null;
  const root = parse(source);
  const skeleton = shown ?? buildSkeleton(source, root);
  const candidates = occurrences(skeleton.chars, needle);
  if (candidates.length === 0) return null;
  const at = pickCandidate(candidates, skeleton, needle.length, hint);
  if (at === null) return null;
  const first = skeleton.offsets[at];
  const last = skeleton.offsets[at + needle.length - 1];
  if (first < 0 || last < 0) return null;
  for (let i = at; i < at + needle.length; i++) if (skeleton.offsets[i] < 0) return null;
  // `\*` shows as `*`: the escape belongs with it, or the replacement would start escaped.
  const start = first > 0 && source[first - 1] === '\\' && ESCAPABLE.test(source[first]) ? first - 1 : first;
  // `&amp;` shows as `&`: a range ending on its `&` must take the whole reference.
  const entity = source[last] === '&' ? ENTITY.exec(source.slice(last)) : null;
  return expandInline(root, { start, end: entity ? last + entity[0].length : last + 1 });
}

/** The range grown to whole blocks: from the start of the first block it touches to the end of the last. */
export function expandToBlocks(blocks: readonly MarkdownBlock[], range: SourceRange): SourceRange {
  const first = blockIndexAt(blocks, range.start);
  const last = blockIndexAt(blocks, Math.max(range.start, range.end - 1));
  return {
    start: first >= 0 ? Math.min(range.start, blocks[first].start) : range.start,
    end: last >= 0 ? Math.max(range.end, blocks[last].end) : range.end,
  };
}

const BLOCK_LINE = /^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|>|\|.*\||`{3,}|~{3,}|\$\$)/;

/** Text that is blocks of its own (paragraphs, a list, a table): it replaces whole blocks, never part of a sentence. */
export function isBlockLevelText(text: string): boolean {
  const body = text.trim();
  if (/\n\s*\n/.test(body)) return true;
  return body.split('\n').some((line) => BLOCK_LINE.test(line));
}

/** The range holds the whole of every block it touches (give or take surrounding whitespace). */
function coversWholeBlocks(source: string, blocks: readonly MarkdownBlock[], range: SourceRange): boolean {
  const grown = expandToBlocks(blocks, range);
  return source.slice(grown.start, range.start).trim() === '' && source.slice(range.end, grown.end).trim() === '';
}

const MARKER_ONLY = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+$/;
const INSIDE_LIST = /^(?:[ \t]+\S|[ \t]*(?:[-*+]|\d+[.)])[ \t])/;

/**
 * List items selected whole, as the page shows them: from just after the first item's bullet (the
 * bullet is never part of a selection) to the end of a line. The rewrite takes their place as long
 * as each of its lines after the first stays in the list — indented, or an item of its own — since
 * a bare line there would run into the item above, and a blank one would loosen the list.
 */
function wholeListItems(source: string, range: SourceRange, body: string): { start: number; end: number; text: string } | null {
  const lineStart = source.lastIndexOf('\n', range.start - 1) + 1;
  if (!MARKER_ONLY.test(source.slice(lineStart, range.start))) return null;
  const lineEnd = source.indexOf('\n', range.end);
  if (source.slice(range.end, lineEnd < 0 ? source.length : lineEnd).trim()) return null;
  const [, ...below] = body.split('\n');
  if (!below.every((line) => INSIDE_LIST.test(line))) return null;
  return { start: range.start, end: range.end, text: body };
}

/**
 * Where a replacement goes, or null when it cannot go anywhere without losing text the user did
 * not select. A phrase replaces the selected words. Block-level text (paragraphs, a list, a table)
 * replaces the blocks the selection covers whole; inside one paragraph it splits it, keeping the
 * words before and after the selection as paragraphs of their own. Whole items of a list take a
 * rewrite that is still list items. Any other part of a list, or of a table, a quote or a
 * `<details>`, cannot hold a new block, so that is refused — insert below instead.
 */
export function planReplace(source: string, range: SourceRange, text: string): { start: number; end: number; text: string } | null {
  const body = text.trim();
  const blocks = splitMarkdownBlocks(source);
  const first = blockIndexAt(blocks, range.start);
  const last = blockIndexAt(blocks, Math.max(range.start, range.end - 1));
  const block = blocks[first];
  // Lines over lines of a list: plain lines in place of items would run into the item above.
  const overItems = block?.kind === 'list' && body.includes('\n') && source.slice(range.start, range.end).includes('\n');
  if (!isBlockLevelText(body) && !overItems) return { start: range.start, end: range.end, text: body };
  if (coversWholeBlocks(source, blocks, range)) {
    const grown = expandToBlocks(blocks, range);
    return { start: grown.start, end: grown.end, text: body };
  }
  if (first < 0 || first !== last) return null;
  if (block.kind === 'list') return wholeListItems(source, range, body);
  if (block.kind !== 'paragraph' || range.start < block.start || range.end > block.end) return null;
  const before = source.slice(block.start, range.start).trimEnd();
  const after = source.slice(range.end, block.end).trimStart();
  return { start: block.start, end: block.end, text: [before, body, after].filter(Boolean).join('\n\n') };
}

/**
 * The source with `text` in place of `range` (see `planReplace`; null when it cannot be placed),
 * or after the block where the range ends, as a block of its own.
 */
export function applyRewrite(source: string, range: SourceRange, text: string, mode: 'replace' | 'insertBelow'): string | null {
  const body = text.trim();
  if (mode === 'replace') {
    const plan = planReplace(source, range, body);
    return plan ? `${source.slice(0, plan.start)}${plan.text}${source.slice(plan.end)}` : null;
  }
  const blocks = splitMarkdownBlocks(source);
  const index = blockIndexAt(blocks, Math.max(range.start, range.end - 1));
  const at = index >= 0 ? blocks[index].end : source.trimEnd().length;
  return `${source.slice(0, at)}\n\n${body}${source.slice(at)}`;
}
