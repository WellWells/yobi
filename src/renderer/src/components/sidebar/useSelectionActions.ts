import { useCallback, useMemo, useState } from 'react';
import type { BatchCaptureFormat, OutputFile } from '../../../../shared/types';
import { copyFilesWithNotice } from './fileMenuActions';
import { selectionPinTarget } from './pinActions';
import type { SelectionAction } from './SelectionMenuItems';

interface SelectionActionDeps {
  selectMode: boolean;
  selectedIds: ReadonlySet<string>;
  /** The conversations drawn, in list order. */
  visibleFiles: readonly OutputFile[];
  setPinned: (paths: string[], pinned: boolean) => void;
  exportZip: (files: OutputFile[]) => Promise<unknown>;
  exportCards: (format: BatchCaptureFormat, files: OutputFile[]) => Promise<unknown>;
  moveTo: (paths: readonly string[], folder: string) => Promise<void>;
  createFolder: (paths: readonly string[]) => Promise<void>;
  t: (key: string) => string;
}

/**
 * What the selection bar and the selection's right-click menu do with the checked conversations:
 * pin, export, move to a folder. Always in list order, not click order, so files come out in the
 * order the user sees them. Each action closes the selection's menu.
 */
export function useSelectionActions(deps: SelectionActionDeps) {
  const { selectMode, selectedIds, visibleFiles, setPinned, exportZip, exportCards, moveTo, createFolder, t } = deps;
  const [selectionMenu, setSelectionMenu] = useState<{ x: number; y: number } | null>(null);

  const pickedFiles = useMemo(
    () => visibleFiles.filter((file) => selectedIds.has(file.path)),
    [visibleFiles, selectedIds],
  );
  const pickedPaths = useMemo(() => pickedFiles.map((file) => file.path), [pickedFiles]);

  const selectionPin = useMemo(
    () => (selectMode ? selectionPinTarget(visibleFiles, selectedIds) : null),
    [selectMode, visibleFiles, selectedIds],
  );

  const pinSelection = useCallback((pinned: boolean) => {
    setSelectionMenu(null);
    setPinned(pickedPaths, pinned);
  }, [pickedPaths, setPinned]);

  const runSelectionAction = useCallback((action: SelectionAction) => {
    setSelectionMenu(null);
    if (pickedFiles.length === 0) return;
    if (action === 'copy') void copyFilesWithNotice(pickedPaths, t);
    else if (action === 'zip') void exportZip(pickedFiles);
    else void exportCards(action, pickedFiles);
  }, [pickedFiles, pickedPaths, exportZip, exportCards, t]);

  const moveSelection = useCallback((folder: string) => {
    setSelectionMenu(null);
    void moveTo(pickedPaths, folder);
  }, [pickedPaths, moveTo]);

  const moveSelectionToNew = useCallback(() => {
    setSelectionMenu(null);
    void createFolder(pickedPaths);
  }, [pickedPaths, createFolder]);

  return {
    selectionMenu,
    setSelectionMenu,
    closeSelectionMenu: useCallback(() => setSelectionMenu(null), []),
    pickedFiles,
    /**
     * How many the bar reports: the checked rows that are drawn. A checked conversation moved
     * into, or left in, a closed folder stays checked but no action reaches it.
     */
    count: pickedFiles.length,
    selectionPin,
    pinSelection,
    runSelectionAction,
    moveSelection,
    moveSelectionToNew,
  };
}
