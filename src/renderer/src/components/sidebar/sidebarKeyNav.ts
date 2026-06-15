import type React from 'react';
import type { OutputFile } from '../../../../shared/types';
import { isTypingTarget } from '../../utils/domUtils';

interface SidebarKeyNavDeps {
  editingPath: string | null;
  pendingDeleteFile: OutputFile | null;
  visibleFiles: OutputFile[];
  selectedFile: OutputFile | null;
  fileItemRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  scrollToIndex: (index: number, options: { align: 'auto' }) => void;
  getFocusedFile: () => OutputFile | null;
  onSelect: (file: OutputFile) => Promise<void>;
  onRename: (file: OutputFile) => void;
  onEditH1: (file: OutputFile) => Promise<void>;
  onDelete: (file: OutputFile) => void;
  onCloseContextMenu: () => void;
}

export function createSidebarKeyDownHandler({
  editingPath, pendingDeleteFile, visibleFiles, selectedFile, fileItemRefs,
  scrollToIndex, getFocusedFile, onSelect, onRename, onEditH1, onDelete, onCloseContextMenu,
}: SidebarKeyNavDeps): (e: React.KeyboardEvent) => void {
  return (e) => {
    if (editingPath || pendingDeleteFile || isTypingTarget(e.target)) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      let currentIdx = -1;
      for (const [path, node] of fileItemRefs.current.entries()) {
        if (node === document.activeElement) {
          currentIdx = visibleFiles.findIndex((f) => f.path === path);
          break;
        }
      }
      if (currentIdx < 0) return;
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      const nextIdx = Math.max(0, Math.min(visibleFiles.length - 1, currentIdx + delta));
      if (nextIdx === currentIdx) return;
      scrollToIndex(nextIdx, { align: 'auto' });
      window.requestAnimationFrame(() => {
        const next = fileItemRefs.current.get(visibleFiles[nextIdx]?.path ?? '');
        next?.focus();
      });
      return;
    }

    const focusedFile = getFocusedFile();
    if (!focusedFile) return;
    const key = e.key.toLowerCase();

    if (!e.ctrlKey && !e.shiftKey && !e.altKey && e.key === 'F2') {
      e.preventDefault();
      void onEditH1(focusedFile);
      return;
    }

    if (
      (e.altKey && !e.ctrlKey && !e.shiftKey && key === 'r')
      || (e.ctrlKey && e.shiftKey && !e.altKey && key === 'o')
    ) {
      e.preventDefault();
      void window.electronAPI.showInFolder(focusedFile.path);
      onCloseContextMenu();
      return;
    }

    if (e.key === 'Delete') {
      e.preventDefault();
      onDelete(focusedFile);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedFile?.path === focusedFile.path) {
        onRename(focusedFile);
        return;
      }
      void onSelect(focusedFile);
      return;
    }

    if (e.key === ' ') {
      e.preventDefault();
      void onSelect(focusedFile);
    }
  };
}
