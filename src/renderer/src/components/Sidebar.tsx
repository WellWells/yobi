import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Menu as MMenu, Stack, Tooltip } from '@mantine/core';
import { useVirtualizer, observeElementRect, measureElement } from '@tanstack/react-virtual';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../store/appStore';
import { useI18nStore } from '../store/i18nStore';
import { noteConversationOpened } from '../store/recapStore';
import type { BatchCaptureFormat, OutputFile } from '../../../shared/types';
import { PanelToolbar, ToolbarButton, ToolbarIconButton } from './PanelToolbar';
import { EmptyState } from './EmptyState';
import { WebDialog } from './WebDialog';
import { ContextMenuPortal } from './ContextMenuPortal';
import { GroupHeader } from './GroupHeader';
import { ShortcutHint } from './ShortcutHint';
import { SelectionActionBar } from './SelectionActionBar';
import { ChevronDown, Download, MessageSquare, Search, SquarePen, Trash2, Upload } from 'lucide-react';
import { AppButton } from './AppButton';
import { SelectionMenuItems } from './sidebar/SelectionMenuItems';
import type { SelectionAction } from './sidebar/SelectionMenuItems';
import { BatchExportStrip } from './sidebar/BatchExportStrip';
import { useBatchExport } from './sidebar/useBatchExport';
import { fileApi } from '../api/electronApi';
import { FileItem } from './sidebar/FileItem';
import { FileContextMenu } from './sidebar/FileContextMenu';
import { copyFilesWithNotice } from './sidebar/fileMenuActions';
import { useSidebarFileActions } from './sidebar/useSidebarFileActions';
import { pathsToDrag, useConversationImport } from './sidebar/useConversationImport';
import { SidebarImportMenu } from './sidebar/SidebarImportMenu';
import { FileDropZone } from './chat/FileDropZone';
import { markInternalFileDrag } from '../utils/internalFileDrag';
import { createSidebarKeyDownHandler } from './sidebar/sidebarKeyNav';
import { useMultiSelect } from '../hooks/useMultiSelect';
import { useReloadOpenConversation } from '../hooks/useReloadOpenConversation';
import { useFormatTime } from '../hooks/useFormatTime';
import { buildSidebarRows } from '../utils/timeGroups';
import { containsActiveElement } from '../utils/domUtils';
import { useResolvedCombo } from '../store/shortcutStore';
import { comboLabel } from '../../../shared/shortcuts';
import { isMac } from '../utils/keyLabels';
import { useShortcutAction } from '../shortcuts/useShortcutAction';

interface SidebarProps {
  onNewConversation: () => void;
  onOpenSearch: () => void;
}

const FILE_ROW_HEIGHT = 72;
const HEADER_ROW_HEIGHT = 34;
// Group labels start in the same column as the conversation titles: the row inset plus the
// `.fileItem` left border and left padding in Sidebar.module.css.
const ROW_INSET = 8;
const HEADER_INSET = 20;

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

  // `[]` looks like "no saved chats", and a cold first read can take a while, so track loading.
  const [filesLoaded, setFilesLoaded] = useState(false);
  useEffect(() => {
    void loadFiles().finally(() => setFilesLoaded(true));
    const unsub = window.electronAPI.onFileListUpdate((nextFiles) => {
      setFiles(nextFiles, { markUnread: true });
    });
    return unsub;
  }, [loadFiles, setFiles]);

  useReloadOpenConversation();

  useShortcutAction('files.delete', () => {
    if (!selection.selectMode || selection.count === 0) return;
    setBulkDeleteOpen(true);
  }, 'chat');

  const newChatCombo = useResolvedCombo('chat.newConversation');
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
    noteConversationOpened(file.path);
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

  const handleImportFiles = useConversationImport(handleSelect);
  const resetImportPicker = useRef<() => void>(null);
  const handlePickedFiles = useCallback((picked: File[]) => {
    handleImportFiles(picked);
    // Picking the same file again must fire onChange again.
    resetImportPicker.current?.();
  }, [handleImportFiles]);
  // A Notion import names its file; the list main broadcast has the row to open.
  const handleOpenImported = useCallback((path: string): void => {
    void fileApi.getList().then((list) => {
      const file = list.find((entry) => entry.path === path);
      if (file) void handleSelect(file);
    });
  }, [handleSelect]);

  const handleDragOut = useCallback((file: OutputFile) => {
    markInternalFileDrag();
    fileApi.startDrag(pathsToDrag(file.path, selection.selectMode, selection.selectedIds, selectableIds));
  }, [selection.selectMode, selection.selectedIds, selectableIds]);

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
    editingPath, editingText, setEditingText,
    pendingDeleteFile, setPendingDeleteFile, contextMenu, setContextMenu,
    openContextMenu, startEditH1, startDelete,
    handleConfirmDelete, handleCommitEdit, handleCancelEdit,
  } = useSidebarFileActions({
    visibleFiles, selectedFile, selectFile, setFileContent, loadFiles, onSelect: handleSelect,
  });
  const closeContextMenu = useCallback(() => setContextMenu(null), [setContextMenu]);

  const batch = useBatchExport();
  const exportOneCard = useCallback((format: BatchCaptureFormat, file: OutputFile) => {
    void batch.exportCards(format, [file]);
  }, [batch.exportCards]);
  const [selectionMenu, setSelectionMenu] = useState<{ x: number; y: number } | null>(null);

  const runSelectionAction = useCallback((action: SelectionAction) => {
    setSelectionMenu(null);
    // List order, not click order, so the files come out in the order the user sees them.
    const picked = visibleFiles.filter((file) => selection.selectedIds.has(file.path));
    if (picked.length === 0) return;
    if (action === 'copy') void copyFilesWithNotice(picked.map((file) => file.path), t);
    else if (action === 'zip') void batch.exportZip(picked);
    else void batch.exportCards(action, picked);
  }, [visibleFiles, selection.selectedIds, batch.exportZip, batch.exportCards, t]);

  // While selecting, a right-click acts on the selection. A row that is not checked yet joins
  // it rather than replacing it — clearing a hand-picked set on a stray click would lose work.
  const handleOpenMenu = useCallback((e: React.MouseEvent<HTMLElement>, file: OutputFile) => {
    if (!selection.selectMode) {
      openContextMenu(e, file);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (!selection.isSelected(file.path)) selection.toggle(file.path);
    setSelectionMenu({ x: e.clientX, y: e.clientY });
  }, [selection, openContextMenu]);

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
    fileItemRefs,
    scrollToIndex: scrollToFileIndex,
    getFocusedFile,
    onSelect: handleSelect,
    onEditH1: startEditH1,
    onDelete: startDelete,
    onCloseContextMenu: closeContextMenu,
  });

  return (
    <FileDropZone
      onFiles={handleImportFiles}
      icon={Download}
      title={t('sidebar.import.dropTitle')}
      detail={t('sidebar.import.dropDetail')}
    >
    <Stack
      gap={0}
      w={240}
      miw={180}
      maw={300}
      bg="var(--mantine-color-default)"
      style={{ borderRight: '1px solid var(--mantine-color-default-border)', overflow: 'hidden', position: 'relative' }}
    >
      <PanelToolbar>
        <Tooltip label={comboLabel(newChatCombo, isMac)} position="bottom">
          <ToolbarButton icon={SquarePen} label={t('chat.new')} onClick={onNewConversation} />
        </Tooltip>
        <ToolbarIconButton icon={Search} label={t('sidebar.search.tooltip')} onClick={onOpenSearch} />
        {/* Local files (the same import as dropping them on the list) or a Notion page. */}
        <SidebarImportMenu onPickFiles={handlePickedFiles} resetRef={resetImportPicker} onOpenPath={handleOpenImported} t={t} />
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
                    padding: row.kind === 'header' ? `0 ${ROW_INSET}px 0 ${HEADER_INSET}px` : `2px ${ROW_INSET}px`,
                  }}
                >
                  {row.kind === 'file' ? (
                    <FileItem
                      file={row.file}
                      selected={selectedFile?.path === row.file.path}
                      unread={Boolean(unreadFilePaths[row.file.path])}
                      unreadLabel={unreadLabel}
                      isEditing={editingPath === row.file.path}
                      editingText={editingText}
                      setEditingText={setEditingText}
                      selectMode={selection.selectMode}
                      checked={selection.isSelected(row.file.path)}
                      onToggleSelect={selection.toggle}
                      onRowClick={handleRowClick}
                      onOpenMenu={handleOpenMenu}
                      onDragOut={handleDragOut}
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

      <BatchExportStrip state={batch.state} onStop={batch.stop} onDismiss={batch.dismiss} t={t} />

      {selection.selectMode && !batch.running && (
        <SelectionActionBar
          count={selection.count}
          allSelected={selection.allSelected(selectableIds)}
          onToggleAll={() => selection.toggleAll(selectableIds)}
          onDelete={() => setBulkDeleteOpen(true)}
          onCancel={selection.exit}
          t={t}
          extraActions={(
            <MMenu position="top-start" withinPortal>
              <MMenu.Target>
                <AppButton
                  size="xs"
                  variant="default"
                  leftSection={<Upload size={13} />}
                  rightSection={<ChevronDown size={13} />}
                  disabled={selection.count === 0}
                >
                  {t('selection.export')}
                </AppButton>
              </MMenu.Target>
              <MMenu.Dropdown>
                <SelectionMenuItems onAction={runSelectionAction} t={t} />
              </MMenu.Dropdown>
            </MMenu>
          )}
        />
      )}

      <ContextMenuPortal position={selectionMenu} onClose={() => setSelectionMenu(null)}>
        <SelectionMenuItems onAction={runSelectionAction} disabled={batch.running} t={t} />
        <MMenu.Divider />
        <MMenu.Item
          leftSection={<Trash2 size={13} />}
          color="red"
          rightSection={<ShortcutHint combo={deleteCombo} />}
          disabled={batch.running}
          onClick={() => { setSelectionMenu(null); setBulkDeleteOpen(true); }}
        >
          {t('common.delete')}
        </MMenu.Item>
      </ContextMenuPortal>

      <FileContextMenu
        menu={contextMenu}
        onClose={closeContextMenu}
        t={t}
        canSelectMultiple={visibleFiles.length >= 2}
        exportBusy={batch.running}
        onEditH1={startEditH1}
        onStartSelection={handleStartSelection}
        onDelete={startDelete}
        onExportCards={exportOneCard}
      />

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
    </FileDropZone>
  );
};
