import { useEffect, useRef } from 'react';
import type { BatchCaptureFormat, OutputFile } from '../../../../shared/types';
import type {
  ConversationMenuCommandEvent, ConversationMenuFolder, ConversationMenuTarget,
} from '../../../../shared/conversationMenu';
import type { ConversationFolder } from '../../../../shared/conversationFolders';
import { conversationMoveKey } from '../../../../shared/conversationMove';
import { conversationMenuApi, fileApi } from '../../api/electronApi';
import { useAppStore } from '../../store/appStore';
import { useFolderStore } from '../../store/folderStore';
import { useI18nStore } from '../../store/i18nStore';
import { exportConversationMarkdown } from '../../utils/conversationMarkdownExport';
import { folderLabel } from './folderActions';
import { isMac } from '../../utils/keyLabels';

/*
 * The renderer's side of the macOS menu bar's Conversation menu. It reports the conversation open
 * in the main window, and runs a clicked command with the sidebar's own handlers — the same pin,
 * title edit, export and delete (to Recently Deleted, with the undo notice) as the context menu.
 */

/** The sidebar handlers a menu command runs. */
export interface ConversationMenuHandlers {
  onNew: () => void;
  onTogglePin: (file: OutputFile) => void;
  onEditTitle: (file: OutputFile) => void;
  onReveal: (file: OutputFile) => void;
  onExportCards: (format: BatchCaptureFormat, file: OutputFile) => void;
  onExportMarkdown: (file: OutputFile) => void;
  /** Into a folder by name, '' for the top level. */
  onMoveToFolder: (file: OutputFile, folder: string) => void;
  onMoveToNewFolder: (file: OutputFile) => void;
  onDelete: (file: OutputFile) => void;
}

/**
 * What the menu acts on: the open conversation, with its pin state from the list (the list is
 * what a pin broadcast refreshes). Null when none is open, e.g. a new or temporary chat.
 */
export function menuTargetFor(
  selected: OutputFile | null,
  files: readonly OutputFile[],
  folders: readonly ConversationMenuFolder[] = [],
): ConversationMenuTarget | null {
  if (!selected?.path) return null;
  const key = conversationMoveKey(selected.path);
  const listed = files.find((file) => conversationMoveKey(file.path) === key) ?? selected;
  return { path: selected.path, pinned: Boolean(listed.pinned), folder: listed.folder ?? null, folders: [...folders] };
}

/**
 * Opens the folder a conversation sits in. The title editor lives on the drawn row, so editing a
 * conversation hidden in a closed folder would otherwise leave an editor nobody can see or leave.
 */
export function showRowOf(file: OutputFile): void {
  if (file.folder) useFolderStore.getState().setOpen(file.folder, true);
}

/** The folders as the menu lists them: the name on disk and the name the sidebar shows. */
export function menuFoldersFor(folders: readonly ConversationFolder[], t: (key: string) => string): ConversationMenuFolder[] {
  return folders.map((folder) => ({ name: folder.name, label: folderLabel(folder.name, t) }));
}

/**
 * Runs one menu command. A conversation command acts on the path the menu was built for, and only
 * while that conversation is still in the list (it may have been deleted since). Returns whether
 * anything ran.
 */
export function runConversationMenuCommand(
  event: ConversationMenuCommandEvent,
  files: readonly OutputFile[],
  handlers: ConversationMenuHandlers,
): boolean {
  if (event.command === 'new') {
    handlers.onNew();
    return true;
  }
  if (!event.path) return false;
  const key = conversationMoveKey(event.path);
  const file = files.find((entry) => conversationMoveKey(entry.path) === key);
  if (!file) return false;
  switch (event.command) {
    case 'togglePin': handlers.onTogglePin(file); break;
    case 'editTitle': handlers.onEditTitle(file); break;
    case 'reveal': handlers.onReveal(file); break;
    case 'exportPdf': handlers.onExportCards('pdf', file); break;
    case 'exportPng': handlers.onExportCards('png', file); break;
    case 'exportMarkdown': handlers.onExportMarkdown(file); break;
    case 'moveToFolder':
      if (typeof event.folder !== 'string') return false;
      handlers.onMoveToFolder(file, event.folder);
      break;
    case 'moveToNewFolder': handlers.onMoveToNewFolder(file); break;
    case 'delete': handlers.onDelete(file); break;
  }
  return true;
}

interface ConversationMenuBridgeDeps {
  selectedFile: OutputFile | null;
  files: readonly OutputFile[];
  onNewConversation: () => void;
  onTogglePin: (file: OutputFile) => void;
  onEditTitle: (file: OutputFile) => void | Promise<void>;
  onExportCards: (format: BatchCaptureFormat, file: OutputFile) => void;
  onDelete: (file: OutputFile) => void;
  folders: readonly ConversationFolder[];
  /** The sidebar's own move (notices for busy or failed files included). */
  onMoveToFolder: (paths: readonly string[], folder: string) => void | Promise<void>;
  /** The sidebar's "New Folder…": makes one, moves the files in, starts renaming it. */
  onMoveToNewFolder: (paths: readonly string[]) => void | Promise<void>;
}

/** Wires the sidebar to the Conversation menu (macOS only; elsewhere there is no such menu). */
export function useConversationMenuBridge(deps: ConversationMenuBridgeDeps): void {
  const t = useI18nStore((s) => s.t);
  const target = menuTargetFor(deps.selectedFile, deps.files, menuFoldersFor(deps.folders, t));
  // A string, so the report goes out only when something the menu shows has changed.
  const report = JSON.stringify(target);
  const latest = useRef(deps);
  latest.current = deps;

  useEffect(() => {
    if (!isMac) return;
    void conversationMenuApi.setTarget(JSON.parse(report) as ConversationMenuTarget | null).catch(() => false);
  }, [report]);

  useEffect(() => {
    if (!isMac) return undefined;
    return conversationMenuApi.onCommand((event) => {
      const current = latest.current;
      const showChat = (): void => useAppStore.getState().setView('chat');
      runConversationMenuCommand(event, current.files, {
        onNew: () => { showChat(); current.onNewConversation(); },
        onTogglePin: current.onTogglePin,
        onEditTitle: (file) => { showChat(); showRowOf(file); void current.onEditTitle(file); },
        onReveal: (file) => { void fileApi.showInFolder(file.path); },
        onExportCards: current.onExportCards,
        onExportMarkdown: (file) => { void exportConversationMarkdown(file.path, useI18nStore.getState().t); },
        onMoveToFolder: (file, folder) => { void current.onMoveToFolder([file.path], folder); },
        onMoveToNewFolder: (file) => { showChat(); void current.onMoveToNewFolder([file.path]); },
        onDelete: current.onDelete,
      });
    });
  }, []);
}
