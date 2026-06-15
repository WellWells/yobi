import { startTransition, useState } from 'react';
import type React from 'react';
import type { OutputFile } from '../../../../shared/types';
import { fileApi } from '../../api/electronApi';
import type { EditMode } from './FileItem';

interface SidebarFileActionsDeps {
  visibleFiles: OutputFile[];
  selectedFile: OutputFile | null;
  selectFile: (file: OutputFile | null) => void;
  setFileContent: (content: string | null) => void;
  loadFiles: () => Promise<OutputFile[]>;
  onSelect: (file: OutputFile) => Promise<void>;
}

export function useSidebarFileActions({
  visibleFiles, selectedFile, selectFile, setFileContent, loadFiles, onSelect,
}: SidebarFileActionsDeps) {
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [editingMode, setEditingMode] = useState<EditMode>(null);
  const [pendingDeleteFile, setPendingDeleteFile] = useState<OutputFile | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: OutputFile } | null>(null);

  const openContextMenu = (e: React.MouseEvent<HTMLElement>, file: OutputFile) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, file });
  };

  const startRenameFile = (file: OutputFile) => {
    setContextMenu(null);
    setEditingPath(file.path);
    setEditingMode('filename');
    setEditingText(file.name.replace(/\.md$/i, '') || file.preview || file.name);
  };

  const startEditH1 = async (file: OutputFile) => {
    setContextMenu(null);
    const content = await fileApi.getContent(file.path);
    const firstLine = content?.split('\n')[0]?.trim() || '';
    const h1 = firstLine.match(/^#\s+(.+)$/)?.[1] || file.preview || file.name.replace(/\.md$/i, '');
    setEditingPath(file.path);
    setEditingMode('h1');
    setEditingText(h1);
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
    if (!editingPath || !editingMode) return;
    const nextText = editingText.trim();
    const activePath = editingPath;
    const mode = editingMode;
    setEditingPath(null);
    setEditingMode(null);
    if (!nextText) return;

    if (mode === 'filename') {
      const result = await fileApi.updateTitle(activePath, nextText);
      if (!result.ok) return;
      const latest = await loadFiles();
      const nextSelected = latest.find((file) => file.path === result.updatedPath) ?? null;
      if (selectedFile?.path === activePath) {
        selectFile(nextSelected);
        if (!nextSelected) {
          setFileContent(null);
          return;
        }
        const updated = await fileApi.getContent(nextSelected.path);
        startTransition(() => {
          setFileContent(updated);
        });
      }
      return;
    }

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
    setEditingMode(null);
    setEditingText('');
  };

  return {
    editingPath,
    editingText,
    setEditingText,
    editingMode,
    pendingDeleteFile,
    setPendingDeleteFile,
    contextMenu,
    setContextMenu,
    openContextMenu,
    startRenameFile,
    startEditH1,
    startDelete,
    handleConfirmDelete,
    handleCommitEdit,
    handleCancelEdit,
  };
}
