import type React from 'react';
import type { ConversationFolder } from '../../../../shared/conversationFolders';
import { folderKey } from '../../../../shared/conversationFolders';
import { knowledgeOfRowKey, sectionOfRowKey } from '../../utils/timeGroups';
import type { SidebarRow, SidebarSectionKey } from '../../utils/timeGroups';
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
  fileItemRefs: React.RefObject<Map<string, HTMLDivElement>>;
  scrollToKey?: (key: string) => void;
  scrollToIndex: (index: number, options: { align: 'auto' }) => void;
  getFocusedFile: () => OutputFile | null;
  onSelect: (file: OutputFile) => Promise<void>;
  onEditH1: (file: OutputFile) => Promise<void>;
  onDelete: (file: OutputFile) => void;
  onTogglePin: (file: OutputFile) => void;
  onCloseContextMenu: () => void;
  folders?: FolderKeyActions;
  sections?: SectionKeyActions;
  knowledge?: KnowledgeKeyActions;
  /** Shift+F10 / the menu key on a row: its "⋯" menu, under the row (the button is not a Tab stop). */
  onRowMenu?: (key: string, row: HTMLElement) => void;
}

/** Shift+F10 or the context-menu key: a row's menu from the keyboard, as in a file manager. */
export function isMenuKey(e: Pick<KeyboardEvent, 'key' | 'shiftKey'>): boolean {
  return e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey);
}

/** Where ↑ ↓ Home End move within `count` rows from `index`; null = not one of them. */
export function walkTarget(key: string, index: number, count: number): number | null {
  if (count === 0 || index < 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowDown') return Math.min(count - 1, index + 1);
  if (key === 'ArrowUp') return Math.max(0, index - 1);
  return null;
}

/** What the keys do on a knowledge base row: Enter/Space start a chat with it, F2 renames it. */
export interface KnowledgeKeyActions {
  open: (id: string) => void;
  rename: (id: string) => void;
}

function handleKnowledgeKey(e: React.KeyboardEvent, id: string, actions: KnowledgeKeyActions): void {
  if (matchesShortcut(e, 'files.editTitle')) {
    e.preventDefault();
    actions.rename(id);
    return;
  }
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    actions.open(id);
  }
}

/** What the keys do on a section heading (Pinned, Folders, Conversations). */
export interface SectionKeyActions {
  isCollapsed: (section: SidebarSectionKey) => boolean;
  setCollapsed: (section: SidebarSectionKey, collapsed: boolean) => void;
}

/** A section heading's keys: Enter/Space close or open it, → opens, ← closes. */
function handleSectionKey(e: React.KeyboardEvent, section: SidebarSectionKey, actions: SectionKeyActions): void {
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    actions.setCollapsed(section, e.key === 'ArrowLeft');
    return;
  }
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    actions.setCollapsed(section, !actions.isCollapsed(section));
  }
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

function focusedKey(fileItemRefs: React.RefObject<Map<string, HTMLDivElement>>): string | null {
  for (const [key, node] of fileItemRefs.current.entries()) {
    if (node === document.activeElement) return key;
  }
  return null;
}

function focusLater(fileItemRefs: React.RefObject<Map<string, HTMLDivElement>>, key: string): void {
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
 * The conversation list's own keys (registry owner `sidebarList`): arrows (and Home/End) move focus through the
 * section headings, folder and conversation rows, Enter and Space open the focused conversation
 * (`sidebar.activate`) — the open one included, which reloads it — or open/close a folder or a
 * section, ← on a conversation in a folder goes to its folder; F2 edits the title (renames a
 * folder), Alt+R reveals it, Alt+P pins or unpins it, Delete moves it (or a folder's
 * conversations) to Recently Deleted (no confirmation).
 */
export function createSidebarKeyDownHandler({
  editingPath, dialogOpen, visibleFiles, navKeys, fileItemRefs, scrollToKey,
  scrollToIndex, getFocusedFile, onSelect, onEditH1, onDelete, onTogglePin, onCloseContextMenu, folders, sections, knowledge,
  onRowMenu,
}: SidebarKeyNavDeps): (e: React.KeyboardEvent) => void {
  const order = navKeys ?? visibleFiles.map((file) => file.path);
  return (e) => {
    if (editingPath || dialogOpen || isTypingTarget(e.target)) return;

    const walking = e.key === 'ArrowDown' || e.key === 'ArrowUp'
      || ((e.key === 'Home' || e.key === 'End') && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey);
    if (walking) {
      e.preventDefault();
      const current = focusedKey(fileItemRefs);
      const currentIdx = current === null ? -1 : order.indexOf(current);
      const nextIdx = walkTarget(e.key, currentIdx, order.length);
      if (nextIdx === null || nextIdx === currentIdx) return;
      const nextKey = order[nextIdx];
      if (nextKey === undefined) return;
      if (scrollToKey) scrollToKey(nextKey);
      else scrollToIndex(nextIdx, { align: 'auto' });
      focusLater(fileItemRefs, nextKey);
      return;
    }

    const key = focusedKey(fileItemRefs);
    if (key && onRowMenu && isMenuKey(e)) {
      const row = fileItemRefs.current.get(key);
      if (!row) return;
      e.preventDefault();
      onRowMenu(key, row);
      return;
    }
    const section = key && sections ? sectionOfRowKey(key) : null;
    if (section && sections) {
      handleSectionKey(e, section, sections);
      return;
    }
    const kbId = key && knowledge ? knowledgeOfRowKey(key) : null;
    if (kbId && knowledge) {
      handleKnowledgeKey(e, kbId, knowledge);
      return;
    }
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
