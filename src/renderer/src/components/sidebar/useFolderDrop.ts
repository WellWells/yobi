import { useCallback, useMemo, useState } from 'react';
import type React from 'react';
import { folderKey } from '../../../../shared/conversationFolders';
import type { OutputFile } from '../../../../shared/types';
import { clearInternalFileDrag, internalDragPaths, isInternalFileDrag } from '../../utils/internalFileDrag';
import type { SidebarRow } from '../../utils/timeGroups';
import { dropTargetForRow, pathsToMove } from './folderActions';

/*
 * Filing conversations by dragging their rows. A row's drag is the native OS file drag that also
 * drags it out of the window (`webContents.startDrag`); dropped back on this list, the drag is
 * recognised as ours by `internalFileDrag` and the conversations are moved — onto a folder row (or
 * a conversation shown in a folder) into that folder, onto a top-level row or the empty space below
 * the list out to the top level — instead of being imported again. Whether Windows and macOS hand
 * the native drag back to the window it started in can only be checked by hand: CDP cannot drive
 * a drag out on Windows (see chat-ui.md).
 */

interface FolderDropDeps {
  files: readonly OutputFile[];
  moveTo: (paths: readonly string[], folder: string) => Promise<void>;
}

function draggedFiles(files: readonly OutputFile[]): OutputFile[] {
  const wanted = new Set(internalDragPaths());
  return files.filter((file) => wanted.has(file.path));
}

export function useFolderDrop({ files, moveTo }: FolderDropDeps) {
  /** `folderKey` of the folder row the drag is over. */
  const [overFolder, setOverFolder] = useState<string | null>(null);

  const accept = useCallback((target: string | null): string[] | null => {
    if (target === null || !isInternalFileDrag()) return null;
    const paths = pathsToMove(draggedFiles(files), target);
    return paths.length > 0 ? paths : null;
  }, [files]);

  const over = useCallback((e: React.DragEvent, target: string | null, folderRow: boolean): void => {
    if (!accept(target)) {
      if (isInternalFileDrag()) setOverFolder(null);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    // 'copy', though the conversations move: Electron's startDrag offers the OS only a copy, and a
    // drop effect the source does not offer makes the drop not allowed — the row lit up and the
    // drop event never came. What happens on drop is ours to decide (a move), not the cursor's.
    e.dataTransfer.dropEffect = 'copy';
    const next = folderRow && target ? folderKey(target) : null;
    setOverFolder((current) => (current === next ? current : next));
  }, [accept]);

  const drop = useCallback((e: React.DragEvent, target: string | null): void => {
    const paths = accept(target);
    setOverFolder(null);
    if (!paths || target === null) return;
    e.preventDefault();
    // Stopped here, the window's own drop listener never hears of it: the drag is over.
    e.stopPropagation();
    clearInternalFileDrag();
    void moveTo(paths, target);
  }, [accept, moveTo]);

  const leaveList = useCallback((e: React.DragEvent): void => {
    const next = e.relatedTarget;
    if (next instanceof Node && e.currentTarget.contains(next)) return;
    setOverFolder(null);
  }, []);

  /** Drop handlers for one row of the list. */
  const rowDropProps = useCallback((row: SidebarRow | undefined) => {
    const target = dropTargetForRow(row);
    // Over a folder or a conversation inside one, that folder's row lights up.
    const folderRow = row?.kind === 'folder' || (row?.kind === 'file' && Boolean(row.inFolder));
    return {
      onDragOver: (e: React.DragEvent) => {
        // A row decides for itself, even when it refuses: the list around it would file the
        // conversations at the top level instead (a drop on a row in their own folder, or pinned).
        if (isInternalFileDrag()) e.stopPropagation();
        over(e, target, folderRow);
      },
      onDrop: (e: React.DragEvent) => drop(e, target),
    };
  }, [over, drop]);

  /** Drop handlers for the list itself: the space around the rows is the top level. */
  const listDropProps = useMemo(() => ({
    onDragOver: (e: React.DragEvent) => over(e, '', false),
    onDrop: (e: React.DragEvent) => drop(e, ''),
    onDragLeave: leaveList,
  }), [over, drop, leaveList]);

  return { overFolder, rowDropProps, listDropProps };
}
