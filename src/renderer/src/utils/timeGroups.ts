import type { OutputFile } from '../../../shared/types';
import type { ConversationFolder } from '../../../shared/conversationFolders';
import { folderKey } from '../../../shared/conversationFolders';
import type { SidebarViewPrefs } from '../../../shared/sidebarView';
import { folderRowKey, sortConversations, sortTime } from './sidebarOrder';
import type { TitleCompare } from './sidebarOrder';

export type TimeGroupKey = 'today' | 'yesterday' | 'past7' | 'past30' | 'older' | 'undated';

/**
 * A sidebar group: the pinned conversations on top, one per time bucket, and `conversations` over
 * the top-level ones when they are not grouped by date but something is drawn above them.
 */
export type SidebarGroupKey = TimeGroupKey | 'pinned' | 'conversations';

export type SidebarRow =
  | { kind: 'header'; key: SidebarGroupKey }
  | { kind: 'folder'; folder: ConversationFolder; count: number; expanded: boolean }
  | {
    kind: 'file';
    file: OutputFile;
    group: TimeGroupKey;
    fileIndex: number;
    /** The time the row shows: when it began under the "created" sort, else its latest activity. */
    time: string;
    /** Drawn inside this folder, indented. */
    inFolder?: string;
  };

export interface SidebarRowModel {
  rows: SidebarRow[];
  rowIndexByFileIndex: number[];
  /** The conversations drawn, in drawn order; `fileIndex` and the keyboard walk this list. */
  visibleFiles: OutputFile[];
}

export interface SidebarRowOptions {
  /** The folders in outputs (an empty one is drawn too). A file's own folder is added when missing. */
  folders?: readonly ConversationFolder[];
  /** `folderKey`s of the folders drawn open. */
  expanded?: ReadonlySet<string>;
  view?: SidebarViewPrefs;
  compareTitles?: TitleCompare;
  /** The name a folder is shown (and ordered) under. */
  folderLabel?: (folder: ConversationFolder) => string;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function calendarDaysBefore(then: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
}

export function resolveTimeGroup(timestamp: string, now: Date): TimeGroupKey {
  if (!timestamp) return 'undated';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'undated';

  const days = calendarDaysBefore(date, now);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return 'past7';
  if (days < 30) return 'past30';
  return 'older';
}

/**
 * The group header to draw above each timestamp, or null where the row continues the bucket above
 * it. A list that falls entirely in one bucket gets no header at all: a lone "today" over
 * everything labels nothing. Timestamps are expected in the order they will be rendered.
 */
export function buildTimeGroupHeads(timestamps: readonly string[], now: Date): (TimeGroupKey | null)[] {
  const groups = timestamps.map((timestamp) => resolveTimeGroup(timestamp, now));
  if (new Set(groups).size < 2) return groups.map(() => null);
  return groups.map((group, index) => (group === groups[index - 1] ? null : group));
}

/** A row's key in the virtual list: a conversation's path, a folder's `folderRowKey`, a group's name. */
export function sidebarRowKey(row: SidebarRow): string {
  if (row.kind === 'header') return `group:${row.key}`;
  return row.kind === 'folder' ? folderRowKey(row.folder.name) : row.file.path;
}

/** The keys of the rows the keyboard walks (folders and conversations), in drawn order. */
export function focusableRowKeys(rows: readonly SidebarRow[]): string[] {
  return rows.filter((row) => row.kind !== 'header').map(sidebarRowKey);
}

const byLocale: TitleCompare = (a, b) => a.localeCompare(b);

/** Every folder once: the listed ones and any a conversation names, by shown name. */
function foldersToDraw(files: readonly OutputFile[], options: SidebarRowOptions): ConversationFolder[] {
  const label = options.folderLabel ?? ((folder: ConversationFolder) => folder.name);
  const compare = options.compareTitles ?? byLocale;
  const seen = new Map<string, ConversationFolder>();
  for (const folder of options.folders ?? []) seen.set(folderKey(folder.name), folder);
  for (const file of files) {
    if (file.folder && !seen.has(folderKey(file.folder))) seen.set(folderKey(file.folder), { name: file.folder, system: false });
  }
  return [...seen.values()].sort((a, b) => compare(label(a), label(b)));
}

/**
 * Header, folder and file rows for `files` as main sends them (latest activity first), drawn like
 * Apple Notes' sidebar: 「已釘選」 (pinned from any folder, in the order given, not repeated below),
 * then each folder — its conversations, indented and sorted, under it while it is open — then the
 * top-level conversations, sorted and, when grouping by date (never under the title sort), split
 * into time groups. Folders hold no time groups of their own: two levels, as Apple's sidebars.
 */
export function buildSidebarRows(files: readonly OutputFile[], now: Date, options: SidebarRowOptions = {}): SidebarRowModel {
  const rows: SidebarRow[] = [];
  const rowIndexByFileIndex: number[] = [];
  const visibleFiles: OutputFile[] = [];
  const sort = options.view?.sort ?? 'activity';
  const pushFile = (file: OutputFile, group: TimeGroupKey, time: string, inFolder?: string): void => {
    const fileIndex = visibleFiles.length;
    visibleFiles.push(file);
    rowIndexByFileIndex.push(rows.length);
    rows.push({ kind: 'file', file, group, fileIndex, time, ...(inFolder ? { inFolder } : {}) });
  };

  const compareTitles = options.compareTitles ?? byLocale;
  const pinned = files.filter((file) => file.pinned);
  if (pinned.length > 0) {
    rows.push({ kind: 'header', key: 'pinned' });
    for (const file of pinned) pushFile(file, resolveTimeGroup(file.timestamp, now), file.timestamp);
  }

  const folders = foldersToDraw(files, options);
  const known = new Set(folders.map((folder) => folderKey(folder.name)));
  for (const folder of folders) {
    const key = folderKey(folder.name);
    const inside = files.filter((file) => file.folder && folderKey(file.folder) === key);
    const expanded = options.expanded?.has(key) ?? false;
    rows.push({ kind: 'folder', folder, count: inside.length, expanded });
    if (!expanded) continue;
    for (const file of sortConversations(inside.filter((entry) => !entry.pinned), sort, compareTitles)) {
      const time = sortTime(file, sort);
      pushFile(file, resolveTimeGroup(time, now), time, folder.name);
    }
  }

  const root = sortConversations(
    files.filter((file) => !file.pinned && !(file.folder && known.has(folderKey(file.folder)))),
    sort,
    compareTitles,
  );
  const byDate = (options.view?.groupByDate ?? true) && sort !== 'title';
  let previousGroup: SidebarGroupKey | null = null;
  if (!byDate && root.length > 0 && rows.length > 0) rows.push({ kind: 'header', key: 'conversations' });
  for (const file of root) {
    const time = sortTime(file, sort);
    const group = resolveTimeGroup(time, now);
    if (byDate && group !== previousGroup) {
      rows.push({ kind: 'header', key: group });
      previousGroup = group;
    }
    pushFile(file, group, time);
  }

  return { rows, rowIndexByFileIndex, visibleFiles };
}
