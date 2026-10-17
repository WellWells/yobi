import { startTransition, useState } from 'react';
import type React from 'react';
import type { OutputFile } from '../../../../shared/types';
import { fileApi } from '../../api/electronApi';
import { conversationHeaderTitle } from '../chat/headerMenu/headerMenuModel';
import type { FileContextMenuState } from './FileContextMenu';

/**
 * What "Edit H1 title" starts from: the title the chat header shows — the H1, else the file name
 * without `.md`. Never the row's preview: a file without an H1 previews its first 200 characters of
 * body, which must not come back as an H1.
 */
export function titleEditSeed(content: string | null, file: Pick<OutputFile, 'name'>): string {
  return conversationHeaderTitle(content, file.name);
}

/** The title to write, or null when there is nothing to write: empty, or the same as where the edit started. */
export function titleToWrite(draft: string, seed: string): string | null {
  const next = draft.trim();
  if (!next || next === seed.trim()) return null;
  return next;
}

interface SidebarFileActionsDeps {
  visibleFiles: OutputFile[];
  selectedFile: OutputFile | null;
  selectFile: (file: OutputFile | null) => void;
  setFileContent: (content: string | null) => void;
  loadFiles: () => Promise<OutputFile[]>;
  onSelect: (file: OutputFile) => Promise<void>;
}

/**
 * Per-row actions: edit the title, delete, the right-click menu. A conversation's title is its
 * H1; the file name is not edited from here.
 */
export function useSidebarFileActions({
  visibleFiles, selectedFile, selectFile, setFileContent, loadFiles, onSelect,
}: SidebarFileActionsDeps) {
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [editingSeed, setEditingSeed] = useState('');
  const [pendingDeleteFile, setPendingDeleteFile] = useState<OutputFile | null>(null);
  const [contextMenu, setContextMenu] = useState<FileContextMenuState | null>(null);

  const openContextMenu = (e: React.MouseEvent<HTMLElement>, file: OutputFile) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, file });
  };

  const startEditH1 = async (file: OutputFile) => {
    setContextMenu(null);
    const seed = titleEditSeed(await fileApi.getContent(file.path), file);
    setEditingPath(file.path);
    setEditingSeed(seed);
    setEditingText(seed);
  };

  const startDelete = (file: OutputFile) => {
    setContextMenu(null);
    setPendingDeleteFile(file);
  };

  const handleConfirmDelete = async () => {
    if (!pendingDeleteFile) return;
    const target = pendingDeleteFile;
    const currentIdx = visibleFiles.findIndex((f) => f.path === target.path);
    const nextFile = visibleFiles[currentIdx + 1] ?? visibleFiles[currentIdx - 1] ?? null;
    setPendingDeleteFile(null);
    const ok = await fileApi.deleteFile(target.path);
    if (!ok) return;
    if (selectedFile?.path === target.path) {
      if (nextFile && nextFile.path !== target.path) {
        await onSelect(nextFile);
      } else {
        selectFile(null);
        setFileContent(null);
      }
    }
  };

  const handleCommitEdit = async () => {
    if (!editingPath) return;
    const nextText = titleToWrite(editingText, editingSeed);
    const activePath = editingPath;
    setEditingPath(null);
    // Enter or a click elsewhere (blur commits) without typing leaves the file untouched.
    if (!nextText) return;

    const ok = await fileApi.updateH1(activePath, nextText);
    if (!ok) return;
    await loadFiles();
    if (selectedFile?.path === activePath) {
      const updated = await fileApi.getContent(activePath);
      startTransition(() => {
        setFileContent(updated);
      });
    }
  };

  const handleCancelEdit = () => {
    setEditingPath(null);
    setEditingText('');
    setEditingSeed('');
  };

  return {
    editingPath,
    editingText,
    setEditingText,
    pendingDeleteFile,
    setPendingDeleteFile,
    contextMenu,
    setContextMenu,
    openContextMenu,
    startEditH1,
    startDelete,
    handleConfirmDelete,
    handleCommitEdit,
    handleCancelEdit,
  };
}
