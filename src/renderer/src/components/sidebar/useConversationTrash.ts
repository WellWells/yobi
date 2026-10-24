import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { OutputFile } from '../../../../shared/types';
import { fileApi, trashApi } from '../../api/electronApi';
import { showAppNotice } from '../../hooks/useUiNotifications';
import { useI18nStore } from '../../store/i18nStore';
import { containsActiveElement } from '../../utils/domUtils';
import { moveConversationsToTrash, neighbourAfterRemoval, openAfterRemoval, trashedPaths } from './conversationTrashActions';

interface ConversationTrashDeps {
  visibleFiles: OutputFile[];
  selectedFile: OutputFile | null;
  selectFile: (file: OutputFile | null) => void;
  setFileContent: (content: string | null) => void;
  onSelect: (file: OutputFile) => Promise<void>;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  fileItemRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  getFocusedFile: () => OutputFile | null;
}

interface PendingPermanent {
  paths: string[];
  openNeighbour: boolean;
}

/**
 * The sidebar's side of Recently Deleted: deleting (to the trash, with an undo notice), the count
 * for the "Recently Deleted" row, and the files that could not be moved, which wait for the user to
 * agree to delete them for good. A deleted open conversation closes as before: one row opens its
 * neighbour, a batch closes it. Focus on a deleted row moves to its neighbour.
 */
export function useConversationTrash(deps: ConversationTrashDeps) {
  const t = useI18nStore((state) => state.t);
  const [count, setCount] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingPermanent, setPendingPermanent] = useState<PendingPermanent | null>(null);
  const depsRef = useRef(deps);
  depsRef.current = deps;

  useEffect(() => {
    void trashApi.list().then((items) => setCount(items.length), () => undefined);
    return trashApi.onChanged(setCount);
  }, []);

  /** Taken before anything is removed: the list and the focus as the user saw them. */
  const prepareRemoval = useCallback((openNeighbour: boolean) => {
    const current = depsRef.current;
    const filesBefore = current.visibleFiles;
    const openPath = current.selectedFile?.path ?? null;
    const focusedPath = containsActiveElement(current.viewportRef.current) ? current.getFocusedFile()?.path ?? null : null;
    return (removed: readonly string[]): void => {
      if (removed.length === 0) return;
      const gone = new Set(removed);
      const latest = depsRef.current;
      const next = openAfterRemoval(filesBefore, openPath, gone, openNeighbour);
      if (next === null) {
        latest.selectFile(null);
        latest.setFileContent(null);
      } else if (next) {
        void latest.onSelect(next);
      }
      if (!focusedPath || !gone.has(focusedPath)) return;
      const target = next ?? neighbourAfterRemoval(filesBefore, focusedPath, gone);
      if (!target) return;
      window.requestAnimationFrame(() => latest.fileItemRefs.current.get(target.path)?.focus());
    };
  }, []);

  const deleteConversations = useCallback(async (paths: readonly string[], openNeighbour: boolean): Promise<void> => {
    if (paths.length === 0) return;
    const finish = prepareRemoval(openNeighbour);
    const result = await moveConversationsToTrash(paths, {
      trash: fileApi.deleteFiles,
      restore: trashApi.restore,
      notify: showAppNotice,
      t,
    });
    finish(trashedPaths(paths, result));
    if (result.failed.length > 0) setPendingPermanent({ paths: result.failed, openNeighbour });
  }, [prepareRemoval, t]);

  const confirmPermanent = useCallback(async (): Promise<void> => {
    const pending = pendingPermanent;
    setPendingPermanent(null);
    if (!pending) return;
    const finish = prepareRemoval(pending.openNeighbour);
    const deleted = await fileApi.deleteFilesPermanently(pending.paths).catch(() => 0);
    if (deleted === 0) {
      showAppNotice({ level: 'error', message: t('trash.deleteFailed') });
      return;
    }
    finish(pending.paths);
  }, [pendingPermanent, prepareRemoval, t]);

  const cancelPermanent = useCallback(() => setPendingPermanent(null), []);

  return {
    count,
    dialogOpen,
    openDialog: useCallback(() => setDialogOpen(true), []),
    closeDialog: useCallback(() => setDialogOpen(false), []),
    pendingPermanent,
    deleteConversations,
    confirmPermanent,
    cancelPermanent,
  };
}
