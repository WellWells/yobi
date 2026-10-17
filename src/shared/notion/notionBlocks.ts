/*
 * Notion-flavored Markdown, as `notion-fetch` returns a page's content and `update_content` matches
 * it: one line per block, children indented with tabs, no blank lines between blocks (Notion strips
 * them), and XML tags for what Markdown has no syntax for (`<callout>`, `<table>`, `<page>`…).
 *
 * The local file keeps that text byte for byte, with one blank line added between top-level blocks
 * so CommonMark renders each block on its own and the paragraph editor (which splits on blank
 * lines) opens one block at a time. `unspaceNotionBlocks` takes them out again before anything is
 * compared with or sent to Notion.
 */

export type NotionBlockKind = 'text' | 'list' | 'code' | 'container' | 'locked' | 'empty';

export interface NotionBlock {
  text: string;
  kind: NotionBlockKind;
}

/** Tags whose block runs to a closing tag on a line of its own. */
const CONTAINER_TAGS = new Set([
  'callout', 'details', 'table', 'columns', 'tabs', 'synced_block', 'synced_block_reference', 'meeting-notes',
]);

/** Containers whose text the user may edit in Yobi; the others are edited in Notion. */
const EDITABLE_CONTAINERS = new Set(['callout', 'details']);

/**
 * Anything Yobi does not edit: tables, layout, child pages and databases (removing their tag
 * deletes or moves them), synced content and media.
 */
const LOCKED_TAG_RE = /<(?:table|columns|tabs|synced_block|synced_block_reference|meeting-notes|page|database|audio|video|file|pdf|embed|unknown|custom-block|table_of_contents|folder)(?=[\s>/])/;

const OPEN_TAG_RE = /^<([a-z][a-z_-]*)(?=[\s>])[^\n]*>\s*$/;
const FENCE_RE = /^(\t*)(`{3,}|~{3,})/;
const LIST_RE = /^(?:[-*+] (?:\[[ xX]\] )?|\d+[.)] )/;

function fenceOf(line: string): { indent: string; marker: string } | null {
  const match = FENCE_RE.exec(line);
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

/** The index just past `<tag …>` … `</tag>`, the closing tag on a line of its own; -1 when it never closes. */
function endOfContainer(lines: readonly string[], start: number, tag: string): number {
  const close = `</${tag}>`;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const fence = fenceOf(line);
    if (fence) {
      i = endOfFence(lines, i, fence) - 1;
      continue;
    }
    if (line.trimEnd() === close) return i + 1;
  }
  return -1;
}

/** The index just past a block's own line and its tab-indented children. */
function endOfLineBlock(lines: readonly string[], start: number): number {
  let i = start + 1;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (!line.startsWith('\t')) break;
    const fence = fenceOf(line);
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

export function isLockedNotionText(text: string): boolean {
  // Code is literal: a snippet that mentions `<table` is still just code.
  if (isClosedFence(text)) return false;
  return LOCKED_TAG_RE.test(text) || /^!\[/m.test(text);
}

function kindOf(text: string, tag: string | null): NotionBlockKind {
  const first = text.split('\n', 1)[0] ?? '';
  if (first.trim() === '<empty-block/>') return 'empty';
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
    const containerEnd = open && CONTAINER_TAGS.has(open[1] ?? '') && !line.includes(`</${open[1]}>`)
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

/** Notion's text with a blank line between top-level blocks; consecutive list items stay together. */
export function spaceNotionBlocks(raw: string): string {
  return joinSpaced(splitNotionBlocks(raw));
}

export function joinSpaced(blocks: readonly NotionBlock[]): string {
  let out = '';
  blocks.forEach((block, index) => {
    if (index > 0) out += block.kind === 'list' && blocks[index - 1]?.kind === 'list' ? '\n' : '\n\n';
    out += block.text;
  });
  return out;
}

/** The text Notion holds for a locally spaced body: the same blocks, one newline apart. */
export function unspaceNotionBlocks(spaced: string): string {
  return splitNotionBlocks(spaced).map((block) => block.text).join('\n');
}
