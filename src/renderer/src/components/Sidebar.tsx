import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Menu as MMenu, Stack, Tooltip } from '@mantine/core';
import { useVirtualizer, observeElementRect, measureElement } from '@tanstack/react-virtual';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../store/appStore';
import { useI18nStore } from '../store/i18nStore';
import type { OutputFile } from '../../../shared/types';
import { PanelToolbar, ToolbarButton, ToolbarIconButton } from './PanelToolbar';
import { EmptyState } from './EmptyState';
import { WebDialog } from './WebDialog';
import { ContextMenuPortal } from './ContextMenuPortal';
import { GroupHeader } from './GroupHeader';
import { ShortcutHint } from './ShortcutHint';
import { SelectionActionBar } from './SelectionActionBar';
import { FolderOpen, ListChecks, MessageSquare, Pencil, Search, SquarePen, Trash2 } from 'lucide-react';
import { fileApi } from '../api/electronApi';
import { FileItem } from './sidebar/FileItem';
import { useSidebarFileActions } from './sidebar/useSidebarFileActions';
import { createSidebarKeyDownHandler } from './sidebar/sidebarKeyNav';
import { useMultiSelect } from '../hooks/useMultiSelect';
import { useFormatTime } from '../hooks/useFormatTime';
import { buildSidebarRows } from '../utils/timeGroups';
import { containsActiveElement } from '../utils/domUtils';
import { useResolvedCombo } from '../store/shortcutStore';
import { toTokens } from '../../../shared/shortcuts';
import { isMac } from '../utils/keyLabels';
import { useShortcutAction } from '../shortcuts/useShortcutAction';

interface SidebarProps {
  onNewConversation: () => void;
  onOpenSearch: () => void;
}

const FILE_ROW_HEIGHT = 72;
const HEADER_ROW_HEIGHT = 34;

const observeRectKeepLast: typeof observeElementRect = (instance, cb) =>
  observeElementRect(instance, (rect) => {
    if (rect.height === 0) return;
    cb(rect);
  });

const measureElementKeepLast: typeof measureElement = (element, entry, instance) => {
  const size = measureElement(element, entry, instance);
  if (size > 0) return size;
  const index = instance.indexFromElement(element);
  return instance.itemSizeCache.get(instance.options.getItemKey(index))
    ?? instance.options.estimateSize(index);
};

export const Sidebar: React.FC<SidebarProps> = ({ onNewConversation, onOpenSearch }) => {
  const { files, selectedFile, selectFile, setFileContent, setFiles, unreadFilePaths } = useAppStore(
    useShallow((s) => ({
      files: s.files,
      selectedFile: s.selectedFile,
      selectFile: s.selectFile,
      setFileContent: s.setFileContent,
      setFiles: s.setFiles,
      unreadFilePaths: s.unreadFilePaths,
    })),
  );
  const { t } = useI18nStore();
  const selection = useMultiSelect();
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const fileItemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const prevDeleteDialogOpenRef = useRef(false);
  const sidebarViewportRef = useRef<HTMLDivElement>(null);

  const loadFiles = useCallback(async () => {
    const latest = await fileApi.getList();
    setFiles(latest);
    return latest;
  }, [setFiles]);

  // The list starts as `[]`, which is indistinguishable from "you have no saved chats" — on a
  // cold file cache the first read stats and reads every .md, so the rail told a returning user
  // their conversations were gone for as long as that took.
  const [filesLoaded, setFilesLoaded] = useState(false);
  useEffect(() => {
    void loadFiles().finally(() => setFilesLoaded(true));
    const unsub = window.electronAPI.onFileListUpdate((nextFiles) => {
      setFiles(nextFiles, { markUnread: true });
    });
    return unsub;
  }, [loadFiles, setFiles]);

  useShortcutAction('files.delete', () => {
    if (!selection.selectMode || selection.count === 0) return;
    setBulkDeleteOpen(true);
  }, 'chat');

  const newChatCombo = useResolvedCombo('chat.newConversation');
  const editTitleCombo = useResolvedCombo('files.editTitle');
  const revealCombo = useResolvedCombo('files.revealInFolder');
  const deleteCombo = useResolvedCombo('files.delete');

  const visibleFiles = files;
  const selectableIds = useMemo(() => visibleFiles.map((f) => f.path), [visibleFiles]);

  const { rows, rowIndexByFileIndex } = useMemo(() => buildSidebarRows(visibleFiles, new Date()), [visibleFiles]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => sidebarViewportRef.current,
    estimateSize: (index) => (rows[index]?.kind === 'header' ? HEADER_ROW_HEIGHT : FILE_ROW_HEIGHT),
    getItemKey: (index) => {
      const row = rows[index];
      if (!row) return index;
      return row.kind === 'header' ? `group:${row.key}` : row.file.path;
    },
    overscan: 5,
    observeElementRect: observeRectKeepLast,
    measureElement: measureElementKeepLast,
  });

  const scrollToFileIndex = useCallback((fileIndex: number) => {
    const rowIndex = rowIndexByFileIndex[fileIndex];
    if (rowIndex === undefined) return;
    rowVirtualizer.scrollToIndex(rowIndex, { align: 'auto' });
  }, [rowIndexByFileIndex, rowVirtualizer]);

  const getFocusedFile = useCallback((): OutputFile | null => {
    const active = document.activeElement;
    if (!(active instanceof HTMLDivElement)) return null;

    for (const [path, node] of fileItemRefs.current.entries()) {
      if (node !== active) continue;
      return visibleFiles.find((file) => file.path === path)
        ?? files.find((file) => file.path === path)
        ?? null;
    }
    return null;
  }, [files, visibleFiles]);

  const handleSelect = useCallback(async (file: OutputFile) => {
    selectFile(file);
    const content = await fileApi.getContent(file.path);
    startTransition(() => {
      setFileContent(content);
    });
  }, [selectFile, setFileContent]);

  const handleRowClick = useCallback((file: OutputFile, mods: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    const result = selection.selectClick(file.path, {
      ctrlKey: mods.ctrlKey || mods.metaKey,
      shiftKey: mods.shiftKey,
      orderedIds: selectableIds,
    });
    if (result === 'open') void handleSelect(file);
  }, [selection, selectableIds, handleSelect]);

  useEffect(() => {
    if (!selection.selectMode) selection.setAnchor(selectedFile?.path ?? null);
  }, [selectedFile?.path, selection.selectMode, selection.setAnchor]);

  const handleBulkDelete = useCallback(async () => {
    const paths = [...selection.selectedIds];
    setBulkDeleteOpen(false);
    if (paths.length === 0) return;
    const removed = new Set(paths);
    await fileApi.deleteFiles(paths);
    if (selectedFile?.path && removed.has(selectedFile.path)) {
      selectFile(null);
      setFileContent(null);
    }
    selection.exit();
    void loadFiles();
  }, [selection, selectedFile, selectFile, setFileContent, loadFiles]);

  const {
    editingPath, editingText, setEditingText, editingMode,
    pendingDeleteFile, setPendingDeleteFile, contextMenu, setContextMenu,
    openContextMenu, startRenameFile, startEditH1, startDelete,
    handleConfirmDelete, handleCommitEdit, handleCancelEdit,
  } = useSidebarFileActions({
    visibleFiles, selectedFile, selectFile, setFileContent, loadFiles, onSelect: handleSelect,
  });

  const handleStartSelection = useCallback((file: OutputFile) => {
    selection.enter();
    selection.toggle(file.path);
    selection.setAnchor(file.path);
    setContextMenu(null);
  }, [selection, setContextMenu]);

  const registerItemRef = useCallback((path: string, node: HTMLDivElement | null) => {
    if (node) {
      fileItemRefs.current.set(path, node);
      return;
    }
    fileItemRefs.current.delete(path);
  }, []);

  useEffect(() => {
    if (!selectedFile?.path || pendingDeleteFile || editingPath) return;
    const idx = visibleFiles.findIndex((f) => f.path === selectedFile.path);
    if (idx >= 0) scrollToFileIndex(idx);
    if (!containsActiveElement(sidebarViewportRef.current)) return;
    const activeItem = fileItemRefs.current.get(selectedFile.path);
    if (!activeItem || document.activeElement === activeItem) return;
    window.requestAnimationFrame(() => {
      fileItemRefs.current.get(selectedFile.path ?? '')?.focus();
    });
  }, [selectedFile?.path, pendingDeleteFile, editingPath]);

  useEffect(() => {
    const wasOpen = prevDeleteDialogOpenRef.current;
    const isOpen = Boolean(pendingDeleteFile);
    prevDeleteDialogOpenRef.current = isOpen;
    if (!wasOpen || isOpen || !selectedFile?.path || editingPath) return;
    const idx = visibleFiles.findIndex((f) => f.path === selectedFile.path);
    if (idx >= 0) scrollToFileIndex(idx);
    const activeItem = fileItemRefs.current.get(selectedFile.path);
    if (!activeItem) return;
    window.requestAnimationFrame(() => activeItem.focus());
  }, [pendingDeleteFile, selectedFile?.path, editingPath]);

  const formatTime = useFormatTime();
  const unreadLabel = t('sidebar.unread');
  const turnsLabel = t('chat.turns');

  const handleListKeyDown = createSidebarKeyDownHandler({
    editingPath,
    pendingDeleteFile,
    visibleFiles,
    selectedFile,
    fileItemRefs,
    scrollToIndex: scrollToFileIndex,
    getFocusedFile,
    onSelect: handleSelect,
    onRename: startRenameFile,
    onEditH1: startEditH1,
    onDelete: startDelete,
    onCloseContextMenu: () => setContextMenu(null),
  });

  return (
    <Stack
      gap={0}
      w={240}
      miw={180}
      maw={300}
      bg="var(--mantine-color-default)"
      style={{ borderRight: '1px solid var(--mantine-color-default-border)', overflow: 'hidden', position: 'relative' }}
    >
      <PanelToolbar>
        <Tooltip label={toTokens(newChatCombo, isMac).join(' + ')} position="bottom">
          <ToolbarButton icon={SquarePen} label={t('chat.new')} onClick={onNewConversation} />
        </Tooltip>
        <ToolbarIconButton icon={Search} label={t('sidebar.search.tooltip')} onClick={onOpenSearch} />
      </PanelToolbar>

      <Box ref={sidebarViewportRef} flex={1} style={{ overflowY: 'auto', padding: '6px 0' }} onKeyDown={selection.selectMode ? undefined : handleListKeyDown}>
        {visibleFiles.length === 0 ? (
          <EmptyState icon={MessageSquare} label={t('sidebar.empty')} busy={!filesLoaded} />
        ) : (
          <Box style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) return null;
              return (
                <Box
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                    padding: row.kind === 'header' ? '0 12px' : '2px 8px',
                  }}
                >
                  {row.kind === 'file' ? (
                    <FileItem
                      file={row.file}
                      selected={selectedFile?.path === row.file.path}
                      unread={Boolean(unreadFilePaths[row.file.path])}
                      unreadLabel={unreadLabel}
                      isEditing={editingPath === row.file.path}
                      editingMode={editingMode}
                      editingText={editingText}
                      setEditingText={setEditingText}
                      selectMode={selection.selectMode}
                      checked={selection.isSelected(row.file.path)}
                      onToggleSelect={selection.toggle}
                      onRowClick={handleRowClick}
                      onOpenMenu={openContextMenu}
                      onCommitEdit={handleCommitEdit}
                      onCancelEdit={handleCancelEdit}
                      timeLabel={formatTime(row.file.timestamp, row.group)}
                      turnsLabel={turnsLabel}
                      registerItemRef={registerItemRef}
                    />
                  ) : (
                    <GroupHeader label={t(`sidebar.group.${row.key}`)} />
                  )}
                </Box>
              );
            })}
          </Box>
        )}
      </Box>

      {selection.selectMode && (
        <SelectionActionBar
          count={selection.count}
          allSelected={selection.allSelected(selectableIds)}
          onToggleAll={() => selection.toggleAll(selectableIds)}
          onDelete={() => setBulkDeleteOpen(true)}
          onCancel={selection.exit}
          t={t}
        />
      )}

      <ContextMenuPortal
        position={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
        onClose={() => setContextMenu(null)}
      >
        <MMenu.Item
          leftSection={<Pencil size={13} />}
          rightSection={<ShortcutHint combo={editTitleCombo} />}
          onClick={() => { void startEditH1(contextMenu!.file); }}
        >
          {t('context.editH1')}
        </MMenu.Item>
        <MMenu.Item
          leftSection={<FolderOpen size={13} />}
          rightSection={<ShortcutHint combo={revealCombo} />}
          onClick={() => { void window.electronAPI.showInFolder(contextMenu!.file.path); setContextMenu(null); }}
        >
          {t('context.showInFolder')}
        </MMenu.Item>
        <MMenu.Divider />
        <MMenu.Item
          leftSection={<ListChecks size={13} />}
          disabled={visibleFiles.length < 2}
          onClick={() => handleStartSelection(contextMenu!.file)}
        >
          {t('selection.selectMultiple')}
        </MMenu.Item>
        <MMenu.Item
          leftSection={<Trash2 size={13} />}
          color="red"
          rightSection={<ShortcutHint combo={deleteCombo} />}
          onClick={() => startDelete(contextMenu!.file)}
        >
          {t('common.delete')}
        </MMenu.Item>
      </ContextMenuPortal>

      <WebDialog
        open={Boolean(pendingDeleteFile)}
        title={t('dialog.deleteFile.message')}
        description={t('dialog.deleteFile.detail').replace('{{file}}', pendingDeleteFile?.name || '')}
        confirmText={t('common.delete')}
        cancelText={t('dialog.cancel')}
        danger
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDeleteFile(null)}
      />

      <WebDialog
        open={bulkDeleteOpen}
        title={t('selection.deleteFiles.confirm').replace('{{count}}', String(selection.count))}
        description={t('selection.delete.detail')}
        confirmText={t('common.delete')}
        cancelText={t('dialog.cancel')}
        danger
        onConfirm={() => { void handleBulkDelete(); }}
        onCancel={() => setBulkDeleteOpen(false)}
      />
    </Stack>
  );
};
