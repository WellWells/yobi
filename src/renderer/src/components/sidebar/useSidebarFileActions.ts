import { startTransition, useState } from 'react';
import type React from 'react';
import type { OutputFile } from '../../../../shared/types';
import { fileApi } from '../../api/electronApi';
import { conversationHeaderTitle } from '../chat/headerMenu/headerMenuModel';
import type { FileContextMenuState } from './FileContextMenu';
import { baseNameOf, movedPathFor } from '../../../../shared/conversationMove';
import { useConversationMoves } from '../../store/conversationMoves';

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
  selectedFile: OutputFile | null;
  setFileContent: (content: string | null) => void;
  loadFiles: () => Promise<OutputFile[]>;
  /** Moves to Recently Deleted; `openNeighbour` opens the next row when the open one goes. */
  deleteConversations: (paths: readonly string[], openNeighbour: boolean) => Promise<void>;
}

/**
 * Per-row actions: edit the title, delete, the right-click menu. A conversation's title is its
 * H1; the file name is not edited from here. Deleting does not ask: it goes to Recently Deleted,
 * and the notice it raises can take it back.
 */
export function useSidebarFileActions({
  selectedFile, setFileContent, loadFiles, deleteConversations,
}: SidebarFileActionsDeps) {
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [editingSeed, setEditingSeed] = useState('');
  const [contextMenu, setContextMenu] = useState<FileContextMenuState | null>(null);

  // A row moved into a folder keeps its title edit and its open menu.
  useConversationMoves((moves) => {
    const movedFile = (file: OutputFile): OutputFile => {
      const to = movedPathFor(moves, file.path);
      return to ? { ...file, path: to, name: baseNameOf(to) } : file;
    };
    setEditingPath((current) => movedPathFor(moves, current) ?? current);
    setContextMenu((current) => (current ? { ...current, file: movedFile(current.file) } : current));
  });

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
    void deleteConversations([file.path], true);
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
    contextMenu,
    setContextMenu,
    openContextMenu,
    startEditH1,
    startDelete,
    handleCommitEdit,
    handleCancelEdit,
  };
}
