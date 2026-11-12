import type { OutputFile } from '../../../shared/types';
import type { ConversationFolder } from '../../../shared/conversationFolders';
import { folderKey } from '../../../shared/conversationFolders';
import type { SidebarViewPrefs } from '../../../shared/sidebarView';
import { folderRowKey, sortConversations, sortTime } from './sidebarOrder';
import type { TitleCompare } from './sidebarOrder';

export type TimeGroupKey = 'today' | 'yesterday' | 'past7' | 'past30' | 'older' | 'undated';

/**
 * The sidebar's three sections, in drawn order, as ChatGPT's, Claude's and Perplexity's sidebars
 * have them: the pinned conversations, the folders, the other (top-level) conversations. Each has
 * a heading that closes and opens it.
 */
export const SIDEBAR_SECTIONS = ['pinned', 'folders', 'conversations'] as const;
export type SidebarSectionKey = typeof SIDEBAR_SECTIONS[number];

export function isSidebarSectionKey(value: unknown): value is SidebarSectionKey {
  return typeof value === 'string' && (SIDEBAR_SECTIONS as readonly string[]).includes(value);
}

export type SidebarRow =
  /** `empty`: the folders heading drawn with no folder yet, so a first one can be made from it. */
  | { kind: 'section'; key: SidebarSectionKey; collapsed: boolean; empty?: true }
  /** A time bucket inside the conversations section. */
  | { kind: 'header'; key: TimeGroupKey }
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
  /** The models the top-level conversations came from, the most used first: what the filter offers. */
  providers: string[];
  /** The model the 「對話」 section is narrowed to, or null — also when none of its conversations has it. */
  providerFilter: string | null;
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
  /** Sections drawn closed: their heading stays, their rows are not drawn. */
  collapsed?: ReadonlySet<SidebarSectionKey>;
  /** Only the top-level conversations answered by this model (the name saved in the file). */
  provider?: string | null;
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

/** A section heading's row key; never a path (paths are absolute) nor a `folderRowKey`. */
export function sectionRowKey(key: string): string {
  return `section:${key}`;
}

/** The section a row key names, or null for any other row. */
export function sectionOfRowKey(rowKey: string): SidebarSectionKey | null {
  const key = rowKey.startsWith('section:') ? rowKey.slice('section:'.length) : null;
  return isSidebarSectionKey(key) ? key : null;
}

/**
 * A row's key in the virtual list: a conversation's path, a folder's `folderRowKey`, a section's
 * `sectionRowKey`, a time group's name.
 */
export function sidebarRowKey(row: SidebarRow): string {
  if (row.kind === 'header') return `group:${row.key}`;
  if (row.kind === 'section') return sectionRowKey(row.key);
  return row.kind === 'folder' ? folderRowKey(row.folder.name) : row.file.path;
}

/** The keys of the rows the keyboard walks (section headings, folders and conversations), in drawn order. */
export function focusableRowKeys(rows: readonly SidebarRow[]): string[] {
  return rows.filter((row) => row.kind !== 'header').map(sidebarRowKey);
}

/** The section the open conversation is drawn in (a folder's conversations are in "folders"). */
export function sectionOfFile(file: Pick<OutputFile, 'pinned' | 'folder'>): SidebarSectionKey {
  if (file.pinned) return 'pinned';
  return file.folder ? 'folders' : 'conversations';
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

/** Each model named by `files`, the one with the most conversations first (ties keep their order). */
function providersByUse(files: readonly OutputFile[]): string[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    if (file.provider) counts.set(file.provider, (counts.get(file.provider) ?? 0) + 1);
  }
  return [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)!);
}

/**
 * Section, folder and file rows for `files` as main sends them (latest activity first), in three
 * sections: 「已釘選」 (pinned from any folder, in the order given, not repeated below), the folders
 * — each one's conversations, indented and sorted, under it while it is open — and 「對話」, the
 * top-level conversations (only one model's, when filtered), sorted and, when grouping by date
 * (never under the title sort), split into time groups. Folders hold no time groups of their own:
 * two levels, as Apple's sidebars. A section with nothing in it is not drawn — except the folders
 * heading, drawn without folders whenever there are conversations, as the place to make the first
 * one; a closed section is drawn as its heading alone.
 */
export function buildSidebarRows(files: readonly OutputFile[], now: Date, options: SidebarRowOptions = {}): SidebarRowModel {
  const rows: SidebarRow[] = [];
  const rowIndexByFileIndex: number[] = [];
  const visibleFiles: OutputFile[] = [];
  let providers: string[] = [];
  let providerFilter: string | null = null;
  const model = (): SidebarRowModel => ({ rows, rowIndexByFileIndex, visibleFiles, providers, providerFilter });
  const sort = options.view?.sort ?? 'activity';
  const pushFile = (file: OutputFile, group: TimeGroupKey, time: string, inFolder?: string): void => {
    const fileIndex = visibleFiles.length;
    visibleFiles.push(file);
    rowIndexByFileIndex.push(rows.length);
    rows.push({ kind: 'file', file, group, fileIndex, time, ...(inFolder ? { inFolder } : {}) });
  };
  /** Draws the section's heading; true when its rows should follow. */
  const openSection = (key: SidebarSectionKey): boolean => {
    const collapsed = options.collapsed?.has(key) ?? false;
    rows.push({ kind: 'section', key, collapsed });
    return !collapsed;
  };

  const compareTitles = options.compareTitles ?? byLocale;
  const pinned = files.filter((file) => file.pinned);
  if (pinned.length > 0 && openSection('pinned')) {
    for (const file of pinned) pushFile(file, resolveTimeGroup(file.timestamp, now), file.timestamp);
  }

  const folders = foldersToDraw(files, options);
  const known = new Set(folders.map((folder) => folderKey(folder.name)));
  if (folders.length === 0 && files.length > 0) {
    rows.push({ kind: 'section', key: 'folders', collapsed: false, empty: true });
  } else if (folders.length > 0 && openSection('folders')) {
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
  }

  const root = files.filter((file) => !file.pinned && !(file.folder && known.has(folderKey(file.folder))));
  providers = providersByUse(root);
  // A filter on a model no top-level conversation has any more is no filter: the section — and
  // the button on its heading that clears it — would otherwise vanish.
  providerFilter = options.provider && providers.includes(options.provider) ? options.provider : null;
  const shown = sortConversations(
    providerFilter ? root.filter((file) => file.provider === providerFilter) : root,
    sort,
    compareTitles,
  );
  if (shown.length === 0 || !openSection('conversations')) return model();
  const byDate = (options.view?.groupByDate ?? true) && sort !== 'title';
  let previousGroup: TimeGroupKey | null = null;
  for (const file of shown) {
    const time = sortTime(file, sort);
    const group = resolveTimeGroup(time, now);
    if (byDate && group !== previousGroup) {
      rows.push({ kind: 'header', key: group });
      previousGroup = group;
    }
    pushFile(file, group, time);
  }

  return model();
}
