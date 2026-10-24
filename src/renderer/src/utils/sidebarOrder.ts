import type { OutputFile } from '../../../shared/types';
import type { ConversationSort } from '../../../shared/sidebarView';
import { folderKey } from '../../../shared/conversationFolders';

/*
 * The orders the conversation list can be drawn in (View › Sort By): latest activity (main's own
 * order), when the conversation began, or its title. Pure.
 */

export type TitleCompare = (a: string, b: string) => number;

/** What the row shows and sorts on as its title: the H1 (preview), else the file name. */
export function conversationTitle(file: Pick<OutputFile, 'preview' | 'name'>): string {
  return (file.preview || file.name).trim();
}

/** The time a row is sorted, grouped and labelled by under `sort`. */
export function sortTime(file: Pick<OutputFile, 'timestamp' | 'createdAt'>, sort: ConversationSort): string {
  return sort === 'created' ? file.createdAt || file.timestamp : file.timestamp;
}

/**
 * `files` (in main's latest-activity order) in the order `sort` asks for. Stable: ties keep the
 * order they came in, so latest activity stays the tiebreak. Undated rows go last when sorting by time.
 */
export function sortConversations(files: readonly OutputFile[], sort: ConversationSort, compareTitles: TitleCompare): OutputFile[] {
  if (sort === 'activity') return [...files];
  const indexed = files.map((file, index) => ({ file, index }));
  indexed.sort((a, b) => {
    if (sort === 'title') return compareTitles(conversationTitle(a.file), conversationTitle(b.file)) || a.index - b.index;
    const ta = sortTime(a.file, sort);
    const tb = sortTime(b.file, sort);
    if (ta !== tb) {
      if (!ta) return 1;
      if (!tb) return -1;
      return tb.localeCompare(ta);
    }
    return a.index - b.index;
  });
  return indexed.map((entry) => entry.file);
}

/** The virtual list's key (and the keyboard order's) for a folder row; a conversation's is its path. */
export function folderRowKey(name: string): string {
  return `folder:${folderKey(name)}`;
}

export function isFolderRowKey(key: string): boolean {
  return key.startsWith('folder:');
}
