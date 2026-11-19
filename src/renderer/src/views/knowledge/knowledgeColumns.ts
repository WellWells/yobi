import type { KnowledgeFile } from '../../../../shared/knowledgeStatus';
import { splitKnowledgePath } from './knowledgeFileRows';
import type { KnowledgeSummaryStatus } from './knowledgeFileRows';

/*
 * A base's file list as the system's file manager has it: every column sorts on its header
 * (again = the other way), names in natural order ("2"
 * before "10"), and every column's width drags on its header's edge. The order and the widths are
 * remembered for every base.
 */

export const KB_COLUMNS = ['name', 'modified', 'created', 'type', 'size', 'extract', 'summary'] as const;
export type KbColumn = typeof KB_COLUMNS[number];
export type KbSortDirection = 'asc' | 'desc';
export interface KbSort { column: KbColumn; direction: KbSortDirection }

export const KB_COLUMN_MIN = 56;
export const KB_COLUMN_MAX = 900;
export const KB_DEFAULT_WIDTHS: Readonly<Record<KbColumn, number>> = {
  name: 320, modified: 150, created: 150, type: 90, size: 84, extract: 116, summary: 116,
};
export const KB_DEFAULT_SORT: KbSort = { column: 'name', direction: 'asc' };
/** The detail panel's width, dragged on its left edge. */
export const KB_PANEL_DEFAULT = 420;
export const KB_PANEL_MIN = 300;
export const KB_PANEL_MAX = 900;

const STORAGE_KEY = 'yobi-kb-file-list';

export interface KbListLayout {
  sort: KbSort;
  widths: Record<KbColumn, number>;
  panel: number;
}

export function clampWidth(width: number, min = KB_COLUMN_MIN, max = KB_COLUMN_MAX): number {
  return Number.isFinite(width) ? Math.round(Math.min(max, Math.max(min, width))) : min;
}

function isColumn(value: unknown): value is KbColumn {
  return typeof value === 'string' && (KB_COLUMNS as readonly string[]).includes(value);
}

/** What was stored, each part checked on its own: a bad part falls back to its default only. */
export function readListLayout(raw: string | null): KbListLayout {
  let stored: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') stored = parsed as Record<string, unknown>;
  } catch {
    stored = {};
  }
  const sort = stored.sort as Partial<KbSort> | undefined;
  const widths = (stored.widths && typeof stored.widths === 'object' ? stored.widths : {}) as Record<string, unknown>;
  return {
    sort: sort && isColumn(sort.column) && (sort.direction === 'asc' || sort.direction === 'desc')
      ? { column: sort.column, direction: sort.direction }
      : KB_DEFAULT_SORT,
    widths: Object.fromEntries(KB_COLUMNS.map((column) => [
      column,
      typeof widths[column] === 'number' ? clampWidth(widths[column]) : KB_DEFAULT_WIDTHS[column],
    ])) as Record<KbColumn, number>,
    panel: typeof stored.panel === 'number' ? clampWidth(stored.panel, KB_PANEL_MIN, KB_PANEL_MAX) : KB_PANEL_DEFAULT,
  };
}

export function loadListLayout(): KbListLayout {
  try {
    return readListLayout(localStorage.getItem(STORAGE_KEY));
  } catch {
    return readListLayout(null);
  }
}

export function saveListLayout(layout: KbListLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Private storage full or off: the layout is only lost for the next start.
  }
}

/** A header click: the same column flips its direction, another column starts ascending. */
export function nextSort(current: KbSort, column: KbColumn): KbSort {
  return current.column === column
    ? { column, direction: current.direction === 'asc' ? 'desc' : 'asc' }
    : { column, direction: 'asc' };
}

/** The type column: the extension in capitals, "" for none. */
export function fileTypeOf(rel: string): string {
  const { name } = splitKnowledgePath(rel);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : '';
}

const EXTRACT_ORDER: Readonly<Record<KnowledgeFile['read'], number>> = { text: 0, ocrPartial: 1, ocr: 2, none: 3, pending: 4 };
const SUMMARY_ORDER: Readonly<Record<KnowledgeSummaryStatus, number>> = {
  ready: 0, stale: 1, running: 2, queued: 3, failed: 4, none: 5,
};

/**
 * The files in the list's order. Names compare naturally and without case, by file name and then
 * folder; every other column breaks ties by name, so equal dates or sizes keep a stable order.
 */
export function sortKnowledgeFiles(
  files: readonly KnowledgeFile[],
  sort: KbSort,
  summaryOf: (file: KnowledgeFile) => KnowledgeSummaryStatus,
  locale?: string,
): KnowledgeFile[] {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  const byName = (a: KnowledgeFile, b: KnowledgeFile): number => {
    const left = splitKnowledgePath(a.path);
    const right = splitKnowledgePath(b.path);
    return collator.compare(left.name, right.name) || collator.compare(left.folder, right.folder);
  };
  const by: Record<KbColumn, (a: KnowledgeFile, b: KnowledgeFile) => number> = {
    name: byName,
    modified: (a, b) => a.mtime - b.mtime,
    created: (a, b) => a.created - b.created,
    type: (a, b) => collator.compare(fileTypeOf(a.path), fileTypeOf(b.path)),
    size: (a, b) => a.size - b.size,
    extract: (a, b) => EXTRACT_ORDER[a.read] - EXTRACT_ORDER[b.read],
    summary: (a, b) => SUMMARY_ORDER[summaryOf(a)] - SUMMARY_ORDER[summaryOf(b)],
  };
  const sign = sort.direction === 'asc' ? 1 : -1;
  const compare = by[sort.column];
  return [...files].sort((a, b) => sign * compare(a, b) || (sort.column === 'name' ? 0 : byName(a, b)));
}
