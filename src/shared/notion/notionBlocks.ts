/*
 * Notion-flavored Markdown, as `notion-fetch` returns a page's content and `update_content` matches
 * it. Notion now writes CommonMark with blank lines between blocks (consecutive items of
 * one list stay together), nested list items indented with spaces, pipe tables for plain tables,
 * and XML tags for what Markdown has no syntax for: containers (`<toggle>`, `<callout>`, `<quote>`,
 * `<columns>`…) whose children sit unindented between the opening and closing lines, inline
 * styles (`<b>`, `<i>`, `<code>`…), `<mention>`, `<date>` and `<p />` for an empty paragraph.
 *
 * Notion's older text (one line per block, children indented with tabs, no blank lines,
 * `<details>`/`<table>` rows and `**bold**`) still splits the same way: a document imported in it
 * keeps its blocks until Notion's newer text is merged in.
 *
 * The local file keeps the page's blocks byte for byte, joined the way Notion joins them
 * (`joinNotionBlocks`), so the file, what is compared with Notion and every `old_str` are the
 * same text.
 */

export type NotionBlockKind = 'text' | 'list' | 'code' | 'container' | 'locked' | 'empty';

export interface NotionBlock {
  text: string;
  kind: NotionBlockKind;
}

/** Tags whose block runs to a matching closing tag on a line of its own. */
const CONTAINER_TAGS = new Set([
  'callout', 'details', 'toggle', 'quote', 'table', 'columns', 'column', 'tabs', 'tab',
  'synced_block', 'synced_block_reference', 'synced-block', 'synced-block-reference', 'meeting-notes',
  'p', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'todo', 'mail',
  'image', 'pdf', 'file', 'audio', 'video', 'bookmark', 'embed', 'equation', 'external_object_instance',
  // A fetched page writes a subpage's title on a line of its own between the tags.
  'page', 'database', 'folder',
]);

/** Containers whose text the user may edit in Yobi; the others are edited in Notion. */
const EDITABLE_CONTAINERS = new Set(['callout', 'details', 'toggle', 'quote']);

/**
 * Anything Yobi does not edit: tables, layout, child pages and databases (removing their tag
 * deletes or moves them), synced content and media.
 */
const LOCKED_TAG_RE = /<(?:table|columns|tabs|synced_block|synced_block_reference|synced-block|synced-block-reference|meeting-notes|page|database|image|audio|video|file|pdf|embed|bookmark|unknown|custom-block|table_of_contents|table-of-contents|external_object_instance|folder)(?=[\s>/])/;

/** The delimiter row under a pipe table's header: `| --- | :-: |`. */
const PIPE_DELIMITER_RE = /^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/m;

const OPEN_TAG_RE = /^<([a-z][a-z0-9_-]*)(?=[\s>])[^\n]*>\s*$/;
const FENCE_RE = /^(\t*)(`{3,}|~{3,})/;
const LIST_RE = /^(?:[-*+] (?:\[[ xX]\] )?|\d+[.)] )/;
const PIPE_ROW_RE = /^\|/;
const EMPTY_RE = /^(?:<empty-block\/>|<p\s*\/>)$/;

function fenceOf(line: string): { indent: string; marker: string } | null {
  const match = FENCE_RE.exec(line.replace(/^ +/, ''));
  return match ? { indent: match[1] ?? '', marker: match[2] ?? '' } : null;
}

function closesFence(line: string, open: { indent: string; marker: string }): boolean {
  const trimmed = line.trim();
  const char = open.marker[0] ?? '`';
  return trimmed.length >= open.marker.length && [...trimmed].every((c) => c === char);
}

/** The index just past a fenced code block opened at `start`. Content lines may sit at any indent. */
function endOfFence(lines: readonly string[], start: number, open: { indent: string; marker: string }): number {
  for (let i = start + 1; i < lines.length; i += 1) {
    if (closesFence(lines[i] ?? '', open)) return i + 1;
  }
  return lines.length;
}

/**
 * The index just past `<tag …>` … `</tag>`, the closing tag on a line of its own and containers
 * of the same tag inside counted (a toggle inside a toggle); -1 when it never closes.
 */
function endOfContainer(lines: readonly string[], start: number, tag: string): number {
  const close = `</${tag}>`;
  let depth = 1;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const fence = fenceOf(line);
    if (fence) {
      i = endOfFence(lines, i, fence) - 1;
      continue;
    }
    const trimmed = line.trim();
    if (trimmed === close) {
      depth -= 1;
      if (depth === 0) return i + 1;
      continue;
    }
    const open = OPEN_TAG_RE.exec(trimmed);
    if (open?.[1] === tag && !trimmed.includes(close) && !trimmed.endsWith('/>')) depth += 1;
  }
  return -1;
}

/** A line ending in an unescaped backslash: a hard line break, the paragraph goes on. */
function endsInHardBreak(line: string): boolean {
  const trailing = /\\+$/.exec(line)?.[0].length ?? 0;
  return trailing % 2 === 1;
}

/**
 * The index just past a block's own line and what belongs to it: tab- or space-indented children
 * (nested list items, the lines of a list item's code block), the lines after a hard break, and a
 * pipe table's rows.
 */
function endOfLineBlock(lines: readonly string[], start: number): number {
  const first = lines[start] ?? '';
  let i = start + 1;
  if (PIPE_ROW_RE.test(first)) {
    while (i < lines.length && PIPE_ROW_RE.test(lines[i] ?? '')) i += 1;
    return i;
  }
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (!line.trim()) break;
    const indented = line.startsWith('\t') || line.startsWith(' ');
    if (!indented && !endsInHardBreak(lines[i - 1] ?? '')) break;
    const fence = indented ? fenceOf(line) : null;
    i = fence ? endOfFence(lines, i, fence) : i + 1;
  }
  return i;
}

/**
 * A whole fenced code block: opened on its first line and closed on its last. A fence that never
 * closes (a code block whose content has a fence of its own, split early) is not trusted as code,
 * or it would carry the tables and child pages after it as unlocked "code".
 */
function isClosedFence(text: string): boolean {
  const lines = text.split('\n');
  const open = fenceOf(lines[0] ?? '');
  return Boolean(open) && lines.length > 1 && closesFence(lines[lines.length - 1] ?? '', open!);
}

/** A pipe table: rows of `|` cells with the delimiter row under the header. */
export function isPipeTable(text: string): boolean {
  return PIPE_ROW_RE.test(text) && PIPE_DELIMITER_RE.test(text);
}

export function isLockedNotionText(text: string): boolean {
  // Code is literal: a snippet that mentions `<table` is still just code.
  if (isClosedFence(text)) return false;
  return LOCKED_TAG_RE.test(text) || /^!\[/m.test(text) || PIPE_DELIMITER_RE.test(text);
}

function kindOf(text: string, tag: string | null): NotionBlockKind {
  const first = text.split('\n', 1)[0] ?? '';
  if (EMPTY_RE.test(first.trim()) && !text.includes('\n')) return 'empty';
  if (isClosedFence(text)) return 'code';
  if (isLockedNotionText(text)) return 'locked';
  if (tag && EDITABLE_CONTAINERS.has(tag)) return 'container';
  if (LIST_RE.test(first)) return 'list';
  return 'text';
}

/**
 * The page's top-level blocks. Blank lines between blocks are not part of any block; blank lines
 * inside a code block or a container are.
 */
export function splitNotionBlocks(raw: string): NotionBlock[] {
  return scanBlocks(raw.replace(/\r\n?/g, '\n')).map(({ text, kind }) => ({ text, kind }));
}

export interface NotionBlockRange extends NotionBlock {
  /** Offsets into the text given (LF line ends), `end` exclusive. */
  start: number;
  end: number;
}

/** The top-level blocks of an LF text with where each sits, for an editor that opens one at a time. */
export function notionBlockRanges(text: string): NotionBlockRange[] {
  return scanBlocks(text);
}

function scanBlocks(text: string): NotionBlockRange[] {
  const lines = text.split('\n');
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  const blocks: NotionBlockRange[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (!line.trim()) {
      i += 1;
      continue;
    }
    let end: number;
    let tag: string | null = null;
    const fence = fenceOf(line);
    const open = OPEN_TAG_RE.exec(line);
    // An equation or container that never closes was a paragraph that only looked like one
    // ("<details> vs <summary>…"): it stays one line rather than swallowing the rest of the page.
    const closingMath = line.trim() === '$$' ? lines.findIndex((candidate, at) => at > i && candidate.trim() === '$$') : -1;
    const containerEnd = open && CONTAINER_TAGS.has(open[1] ?? '') && !line.includes(`</${open[1]}>`) && !line.trimEnd().endsWith('/>')
      ? endOfContainer(lines, i, open[1] ?? '')
      : -1;
    if (fence) {
      end = endOfFence(lines, i, fence);
    } else if (closingMath > 0) {
      end = closingMath + 1;
    } else if (containerEnd > 0) {
      tag = open?.[1] ?? null;
      end = containerEnd;
    } else {
      end = endOfLineBlock(lines, i);
    }
    const blockText = lines.slice(i, end).join('\n');
    const start = offsets[i] ?? 0;
    blocks.push({ text: blockText, kind: kindOf(blockText, tag), start, end: start + blockText.length });
    i = end;
  }
  return blocks;
}

type ListType = 'bullet' | 'task' | 'ordered';

function listTypeOf(text: string): ListType | null {
  if (/^[-*+] \[[ xX]\] /.test(text)) return 'task';
  if (/^[-*+] /.test(text)) return 'bullet';
  if (/^\d+[.)] /.test(text)) return 'ordered';
  return null;
}

/** What Notion puts between two top-level blocks: a newline inside one list, a blank line elsewhere. */
export function notionBlockSeparator(previous: string, next: string): string {
  const type = listTypeOf(previous);
  return type !== null && type === listTypeOf(next) ? '\n' : '\n\n';
}

/** The page text of these blocks, joined as Notion joins them. */
export function joinNotionBlocks(blocks: readonly string[]): string {
  let out = '';
  blocks.forEach((block, index) => {
    if (index > 0) out += notionBlockSeparator(blocks[index - 1] ?? '', block);
    out += block;
  });
  return out;
}

/**
 * The text Notion holds for these blocks, however they were spaced: blank lines the user typed
 * between blocks go, the ones Notion keeps between blocks come back.
 */
export function spaceNotionBlocks(raw: string): string {
  return joinSpaced(splitNotionBlocks(raw));
}

export function joinSpaced(blocks: readonly NotionBlock[]): string {
  return joinNotionBlocks(blocks.map((block) => block.text));
}
