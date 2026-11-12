import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import { normalizeFolderName } from '../../../../shared/conversationFolders';
import type { FlowFolder } from '../../../../shared/flowFolders';
import { fillTemplate } from '../../../../shared/fillTemplate';
import { flowFolderApi } from '../../api/electronApi';
import { showAppNotice } from '../../hooks/useUiNotifications';
import { folderErrorMessage, uniqueFolderName } from '../../components/sidebar/folderActions';
import type { MenuAnchor } from '../../components/RowMoreButton';
import { initFlowFolderStore, useFlowFolderStore } from '../../store/flowFolderStore';
import { useFlowStore } from '../../store/useFlowStore';
import type { FlowFolderMenuState } from './FlowFolderMenu';
import { folderOfFlow } from './flowSidebarRows';

type Translate = (key: string) => string;

/**
 * The flow list's folders: the list from main, renaming in place, the folder menu, and filing
 * flows. A new folder is made under a free default name and renamed in place right away, as the
 * chat sidebar does. Nothing here touches a flow itself: membership lives in main's own file, and a
 * move that needs a new order gets the saved flows back to adopt (unsaved edits stay).
 */
export function useFlowFolders(selectedFlowId: string | null, t: Translate) {
  const folders = useFlowFolderStore((s) => s.folders);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [folderMenu, setFolderMenu] = useState<FlowFolderMenuState | null>(null);
  const foldersRef = useRef(folders);
  foldersRef.current = folders;
  // Enter commits and the input's blur commits again as it goes: only the first one counts.
  const renamingRef = useRef(renaming);
  renamingRef.current = renaming;

  useEffect(() => initFlowFolderStore(), []);

  // The open flow is never hidden in a closed folder or section: opening it, or moving it, opens
  // what it is in. Closing them afterwards is left alone.
  const selectedFolder = selectedFlowId ? folderOfFlow(folders, selectedFlowId) : null;
  useEffect(() => {
    if (selectedFolder === null) return;
    const store = useFlowFolderStore.getState();
    if (selectedFolder) {
      store.setCollapsed('folders', false);
      store.setOpen(selectedFolder, true);
    } else {
      store.setCollapsed('flows', false);
    }
  }, [selectedFlowId, selectedFolder]);

  const startRename = useCallback((name: string) => {
    setFolderMenu(null);
    setRenaming(name);
    setRenameText(name);
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
    void flowFolderApi.rename(from, renameText).then((result) => {
      if (!result.ok) {
        showAppNotice({ level: 'error', message: folderErrorMessage(result.error, t) });
        return;
      }
      if (result.name) useFlowFolderStore.getState().renameOpen(from, result.name);
    }, () => showAppNotice({ level: 'error', message: folderErrorMessage('failed', t) }));
  }, [renameText, t]);

  /** Files the flows into `folder` ('' = the top level), before `before` when given. */
  const moveTo = useCallback(async (flowIds: readonly string[], folder: string, before?: string): Promise<void> => {
    if (flowIds.length === 0) return;
    const result = await flowFolderApi.move([...flowIds], folder, before).catch(() => null);
    if (!result?.ok) {
      const message = result?.error && result.error !== 'failed' ? folderErrorMessage(result.error, t) : t('flow.folder.moveFailed');
      showAppNotice({ level: 'error', message });
      return;
    }
    if (result.flows) useFlowStore.getState().adoptSavedOrder(result.flows);
  }, [t]);

  /** Makes a folder under a free default name, files `flowIds` into it, and starts renaming it. */
  const createFolder = useCallback(async (flowIds: readonly string[] = []): Promise<void> => {
    const name = uniqueFolderName(t('sidebar.folder.defaultName'), foldersRef.current.map((folder) => folder.name));
    const result = await flowFolderApi.create(name).catch(() => null);
    if (!result?.ok || !result.name) {
      showAppNotice({ level: 'error', message: folderErrorMessage(result?.error, t) });
      return;
    }
    const created = result.name;
    const store = useFlowFolderStore.getState();
    store.setCollapsed('folders', false);
    store.setOpen(created, true);
    await moveTo(flowIds, created);
    startRename(created);
  }, [moveTo, startRename, t]);

  /**
   * Deletes a folder without asking: its flows go back to the top level, where they already are in
   * the order. The notice's undo makes it again with those of them still at the top level.
   */
  const deleteFolder = useCallback((name: string): void => {
    setFolderMenu(null);
    void (async () => {
      const result = await flowFolderApi.remove(name).catch(() => null);
      if (!result?.ok) {
        showAppNotice({ level: 'error', message: folderErrorMessage(result?.error, t) });
        return;
      }
      const flowIds = [...result.flowIds];
      showAppNotice({
        level: 'success',
        title: fillTemplate(t('flow.folder.deleted'), { name }),
        ...(flowIds.length > 0 ? { message: t('flow.folder.deletedDetail') } : {}),
        undo: {
          label: t('trash.undo'),
          run: () => {
            void flowFolderApi.restore(name, flowIds).then((made) => {
              if (!made.ok) showAppNotice({ level: 'error', message: folderErrorMessage(made.error, t) });
            }, () => showAppNotice({ level: 'error', message: folderErrorMessage('failed', t) }));
          },
        },
      });
    })();
  }, [t]);

  const openFolderMenu = useCallback((e: React.MouseEvent<HTMLElement>, folder: FlowFolder, flowIds: string[]) => {
    e.preventDefault();
    e.stopPropagation();
    setFolderMenu({ x: e.clientX, y: e.clientY, name: folder.name, flowIds });
  }, []);

  // The "⋯" opens the same menu under the button; again closes it.
  const openFolderMenuAt = useCallback((folder: FlowFolder, flowIds: string[], at: MenuAnchor) => {
    setFolderMenu((current) => (current?.name === folder.name ? null : { ...at, name: folder.name, flowIds }));
  }, []);

  return {
    folders,
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
  };
}
