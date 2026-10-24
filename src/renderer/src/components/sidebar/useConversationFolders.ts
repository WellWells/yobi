import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { ConversationFolder } from '../../../../shared/conversationFolders';
import { normalizeFolderName } from '../../../../shared/conversationFolders';
import type { OutputFile } from '../../../../shared/types';
import { fileApi, folderApi, trashApi } from '../../api/electronApi';
import { showAppNotice } from '../../hooks/useUiNotifications';
import { initFolderStore, refreshFolders, useFolderStore } from '../../store/folderStore';
import type { MenuAnchor } from '../RowMoreButton';
import type { FolderMenuState } from './FolderMenus';
import {
  deleteFolderWithNotice,
  folderErrorMessage,
  folderLabel,
  moveResultNotice,
  uniqueFolderName,
} from './folderActions';

type Translate = (key: string) => string;

/**
 * The sidebar's folders: the list from main, which are open, renaming in place, the folder menu,
 * and moving conversations. A new folder is made under a free default name and renamed in place
 * right away, as Finder does. The folder list is read again whenever the file list changes, so a
 * folder made in Explorer/Finder shows up with the next refresh.
 */
export function useConversationFolders(files: readonly OutputFile[], openPath: string | null, t: Translate) {
  const folders = useFolderStore((s) => s.folders);
  const open = useFolderStore((s) => s.open);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [folderMenu, setFolderMenu] = useState<FolderMenuState | null>(null);
  const foldersRef = useRef(folders);
  foldersRef.current = folders;
  // Enter commits and the input's blur commits again as it goes: only the first one counts.
  const renamingRef = useRef(renaming);
  renamingRef.current = renaming;

  useEffect(() => initFolderStore(), []);
  useEffect(() => refreshFolders(), [files]);

  // The open conversation is never hidden in a closed folder: opening it — or moving it into one,
  // which gives it a new path — opens its folder. Closing the folder afterwards is left alone.
  const openFolderOf = files.find((file) => file.path === openPath)?.folder;
  useEffect(() => {
    if (openFolderOf) useFolderStore.getState().setOpen(openFolderOf, true);
  }, [openPath, openFolderOf]);

  const startRename = useCallback((folder: ConversationFolder) => {
    if (folder.system) return;
    setFolderMenu(null);
    setRenaming(folder.name);
    setRenameText(folder.name);
  }, []);

  const cancelRename = useCallback(() => {
    renamingRef.current = null;
    setRenaming(null);
  }, []);

  const commitRename = useCallback(() => {
    const from = renamingRef.current;
    renamingRef.current = null;
    setRenaming(null);
    if (!from || normalizeFolderName(renameText) === from) return;
    void folderApi.rename(from, renameText).then((result) => {
      if (!result.ok) {
        showAppNotice({ level: 'error', message: folderErrorMessage(result.error, t) });
        return;
      }
      if (result.name) useFolderStore.getState().renameOpen(from, result.name);
    }, () => showAppNotice({ level: 'error', message: folderErrorMessage('failed', t) }));
  }, [renameText, t]);

  const moveTo = useCallback(async (paths: readonly string[], folder: string): Promise<void> => {
    if (paths.length === 0) return;
    const result = await fileApi.moveConversations([...paths], folder).catch(() => null);
    const notice = result ? moveResultNotice(result, t) : { level: 'error' as const, message: t('chat.move.failed') };
    if (notice) showAppNotice(notice);
  }, [t]);

  /** Makes a folder under a free default name, files `paths` into it, and starts renaming it. */
  const createFolder = useCallback(async (paths: readonly string[] = []): Promise<void> => {
    const name = uniqueFolderName(t('sidebar.folder.defaultName'), foldersRef.current.map((folder) => folder.name));
    const result = await folderApi.create(name).catch(() => null);
    if (!result?.ok || !result.name) {
      showAppNotice({ level: 'error', message: folderErrorMessage(result?.error, t) });
      return;
    }
    const created = result.name;
    useFolderStore.getState().setOpen(created, true);
    await moveTo(paths, created);
    startRename({ name: created, system: false });
  }, [moveTo, startRename, t]);

  const deleteFolder = useCallback((folder: ConversationFolder): void => {
    setFolderMenu(null);
    void deleteFolderWithNotice(folder.name, folderLabel(folder.name, t), {
      remove: folderApi.remove,
      create: folderApi.recreate,
      restore: trashApi.restore,
      notify: showAppNotice,
      t,
    });
  }, [t]);

  const openFolderMenu = useCallback((e: React.MouseEvent<HTMLElement>, folder: ConversationFolder) => {
    e.preventDefault();
    e.stopPropagation();
    setFolderMenu({ x: e.clientX, y: e.clientY, folder });
  }, []);

  // The "⋯" opens the same menu under the button; again closes it.
  const openFolderMenuAt = useCallback((folder: ConversationFolder, at: MenuAnchor) => {
    setFolderMenu((current) => (current?.folder.name === folder.name ? null : { ...at, folder }));
  }, []);

  const toggleFolder = useCallback((folder: ConversationFolder) => useFolderStore.getState().toggleOpen(folder.name), []);
  const setFolderOpen = useCallback((folder: ConversationFolder, next: boolean) => useFolderStore.getState().setOpen(folder.name, next), []);

  return {
    folders,
    open,
    renaming,
    renameText,
    setRenameText,
    startRename,
    cancelRename,
    commitRename,
    moveTo,
    createFolder,
    deleteFolder,
    folderMenu,
    closeFolderMenu: useCallback(() => setFolderMenu(null), []),
    openFolderMenu,
    openFolderMenuAt,
    toggleFolder,
    setFolderOpen,
  };
}
