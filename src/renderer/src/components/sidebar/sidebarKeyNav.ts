import type React from 'react';
import type { ConversationFolder } from '../../../../shared/conversationFolders';
import { folderKey } from '../../../../shared/conversationFolders';
import type { SidebarRow } from '../../utils/timeGroups';
import type { OutputFile } from '../../../../shared/types';
import { isTypingTarget } from '../../utils/domUtils';
import { folderRowKey } from '../../utils/sidebarOrder';
import { matchesShortcut } from '../../store/shortcutStore';

/** What the keys do on a folder row; the same key ids as on a conversation row. */
export interface FolderKeyActions {
  /** The folder a row key (`folderRowKey`) names, or null for a conversation's row. */
  folderFor: (key: string) => ConversationFolder | null;
  /** The folder a conversation is drawn inside, or null at the top level or pinned. */
  parentOf: (path: string) => ConversationFolder | null;
  isOpen: (folder: ConversationFolder) => boolean;
  setOpen: (folder: ConversationFolder, open: boolean) => void;
  renameFolder: (folder: ConversationFolder) => void;
  deleteFolder: (folder: ConversationFolder) => void;
}

interface SidebarKeyNavDeps {
  editingPath: string | null;
  /** A dialog over the list (deleting for good what could not go to Recently Deleted). */
  dialogOpen: boolean;
  visibleFiles: OutputFile[];
  /** Every focusable row's key in drawn order (folders and conversations); defaults to the conversations. */
  navKeys?: readonly string[];
  fileItemRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  scrollToKey?: (key: string) => void;
  scrollToIndex: (index: number, options: { align: 'auto' }) => void;
  getFocusedFile: () => OutputFile | null;
  onSelect: (file: OutputFile) => Promise<void>;
  onEditH1: (file: OutputFile) => Promise<void>;
  onDelete: (file: OutputFile) => void;
  onTogglePin: (file: OutputFile) => void;
  onCloseContextMenu: () => void;
  folders?: FolderKeyActions;
}

/** The folder side of the keys, read off the drawn rows: which row key is a folder, which folder a row is in. */
export function folderKeyActionsFor(
  rows: readonly SidebarRow[],
  open: ReadonlySet<string>,
  handlers: Pick<FolderKeyActions, 'setOpen' | 'renameFolder' | 'deleteFolder'>,
): FolderKeyActions {
  const byKey = new Map<string, ConversationFolder>();
  for (const row of rows) if (row.kind === 'folder') byKey.set(folderRowKey(row.folder.name), row.folder);
  const parents = new Map<string, ConversationFolder>();
  for (const row of rows) {
    if (row.kind !== 'file' || !row.inFolder) continue;
    const parent = byKey.get(folderRowKey(row.inFolder));
    if (parent) parents.set(row.file.path, parent);
  }
  return {
    folderFor: (key) => byKey.get(key) ?? null,
    parentOf: (path) => parents.get(path) ?? null,
    isOpen: (folder) => open.has(folderKey(folder.name)),
    ...handlers,
  };
}

function focusedKey(fileItemRefs: React.MutableRefObject<Map<string, HTMLDivElement>>): string | null {
  for (const [key, node] of fileItemRefs.current.entries()) {
    if (node === document.activeElement) return key;
  }
  return null;
}

function focusLater(fileItemRefs: React.MutableRefObject<Map<string, HTMLDivElement>>, key: string): void {
  window.requestAnimationFrame(() => fileItemRefs.current.get(key)?.focus());
}

/** A folder row's keys: Enter/Space open or close it, → opens, ← closes, F2 renames, Delete deletes. */
function handleFolderKey(e: React.KeyboardEvent, folder: ConversationFolder, actions: FolderKeyActions): void {
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    actions.setOpen(folder, e.key === 'ArrowRight');
    return;
  }
  if (matchesShortcut(e, 'files.editTitle')) {
    e.preventDefault();
    actions.renameFolder(folder);
    return;
  }
  if (matchesShortcut(e, 'files.delete')) {
    e.preventDefault();
    actions.deleteFolder(folder);
    return;
  }
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    actions.setOpen(folder, !actions.isOpen(folder));
  }
}

/**
 * The conversation list's own keys (registry owner `sidebarList`): arrows move focus through the
 * folder and conversation rows, Enter and Space open the focused conversation (`sidebar.activate`)
 * — the open one included, which reloads it — or open/close a folder, ← on a conversation in a
 * folder goes to its folder; F2 edits the title (renames a folder), Alt+R reveals it, Alt+P pins or
 * unpins it, Delete moves it (or a folder's conversations) to Recently Deleted (no confirmation).
 */
export function createSidebarKeyDownHandler({
  editingPath, dialogOpen, visibleFiles, navKeys, fileItemRefs, scrollToKey,
  scrollToIndex, getFocusedFile, onSelect, onEditH1, onDelete, onTogglePin, onCloseContextMenu, folders,
}: SidebarKeyNavDeps): (e: React.KeyboardEvent) => void {
  const order = navKeys ?? visibleFiles.map((file) => file.path);
  return (e) => {
    if (editingPath || dialogOpen || isTypingTarget(e.target)) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const current = focusedKey(fileItemRefs);
      const currentIdx = current === null ? -1 : order.indexOf(current);
      if (currentIdx < 0) return;
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      const nextIdx = Math.max(0, Math.min(order.length - 1, currentIdx + delta));
      if (nextIdx === currentIdx) return;
      const nextKey = order[nextIdx];
      if (nextKey === undefined) return;
      if (scrollToKey) scrollToKey(nextKey);
      else scrollToIndex(nextIdx, { align: 'auto' });
      focusLater(fileItemRefs, nextKey);
      return;
    }

    const key = focusedKey(fileItemRefs);
    const folder = key && folders ? folders.folderFor(key) : null;
    if (folder && folders) {
      handleFolderKey(e, folder, folders);
      return;
    }

    const focusedFile = getFocusedFile();
    if (!focusedFile) return;

    if (e.key === 'ArrowLeft' && folders) {
      const parent = folders.parentOf(focusedFile.path);
      if (!parent) return;
      e.preventDefault();
      const parentKey = folderRowKey(parent.name);
      scrollToKey?.(parentKey);
      focusLater(fileItemRefs, parentKey);
      return;
    }

    if (matchesShortcut(e, 'files.editTitle')) {
      e.preventDefault();
      void onEditH1(focusedFile);
      return;
    }

    if (matchesShortcut(e, 'files.revealInFolder')) {
      e.preventDefault();
      void window.electronAPI.showInFolder(focusedFile.path);
      onCloseContextMenu();
      return;
    }

    if (matchesShortcut(e, 'files.togglePin')) {
      e.preventDefault();
      onTogglePin(focusedFile);
      return;
    }

    if (matchesShortcut(e, 'files.delete')) {
      e.preventDefault();
      onDelete(focusedFile);
      return;
    }

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void onSelect(focusedFile);
    }
  };
}
