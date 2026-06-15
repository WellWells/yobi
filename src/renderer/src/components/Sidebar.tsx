import React, { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import { Box, Menu as MMenu, Stack, Text } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../store/appStore';
import { useI18nStore } from '../store/i18nStore';
import type { OutputFile } from '../../../shared/types';
import { AppTextInput } from './AppTextInput';
import { WebDialog } from './WebDialog';
import { ContextMenuPortal } from './ContextMenuPortal';
import { Edit3, FolderOpen, Search, Trash2 } from 'lucide-react';
import { fileApi } from '../api/electronApi';
import { FileItem } from './sidebar/FileItem';
import { useSidebarFileActions } from './sidebar/useSidebarFileActions';
import { createSidebarKeyDownHandler } from './sidebar/sidebarKeyNav';
import { useFormatTime } from '../hooks/useFormatTime';

export const Sidebar: React.FC = () => {
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
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<OutputFile[] | null>(null);
  const searchSeqRef = useRef(0);
  const fileItemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const prevDeleteDialogOpenRef = useRef(false);
  const sidebarViewportRef = useRef<HTMLDivElement>(null);

  const loadFiles = useCallback(async () => {
    const latest = await fileApi.getList();
    setFiles(latest);
    return latest;
  }, [setFiles]);

  useEffect(() => {
    void loadFiles();
    const unsub = window.electronAPI.onFileListUpdate((nextFiles) => {
      setFiles(nextFiles, { markUnread: true });
    });
    return unsub;
  }, [loadFiles, setFiles]);

  useEffect(() => {
    const keyword = query.trim();
    if (!keyword) {
      searchSeqRef.current += 1;
      setSearchResults(null);
      return;
    }
    const seq = ++searchSeqRef.current;
    const timer = setTimeout(async () => {
      const result = await fileApi.search(keyword);
      if (seq === searchSeqRef.current) {
        setSearchResults(result);
      }
    }, 80);
    return () => clearTimeout(timer);
  }, [query, files]);

  const visibleFiles = searchResults ?? files;
  const isSearching = query.trim().length > 0;
  const countLabel = isSearching
    ? `${visibleFiles.length} / ${files.length}`
    : `${files.length}`;

  const rowVirtualizer = useVirtualizer({
    count: visibleFiles.length,
    getScrollElement: () => sidebarViewportRef.current,
    estimateSize: () => 72,
    overscan: 5,
  });

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

  const {
    editingPath, editingText, setEditingText, editingMode,
    pendingDeleteFile, setPendingDeleteFile, contextMenu, setContextMenu,
    openContextMenu, startRenameFile, startEditH1, startDelete,
    handleConfirmDelete, handleCommitEdit, handleCancelEdit,
  } = useSidebarFileActions({
    visibleFiles, selectedFile, selectFile, setFileContent, loadFiles, onSelect: handleSelect,
  });

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
    if (idx >= 0) rowVirtualizer.scrollToIndex(idx, { align: 'auto' });
    const activeItem = fileItemRefs.current.get(selectedFile.path);
    if (!activeItem || document.activeElement === activeItem) return;
    window.requestAnimationFrame(() => {
      fileItemRefs.current.get(selectedFile.path ?? '')?.focus();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFile?.path, pendingDeleteFile, editingPath]);

  useEffect(() => {
    const wasOpen = prevDeleteDialogOpenRef.current;
    const isOpen = Boolean(pendingDeleteFile);
    prevDeleteDialogOpenRef.current = isOpen;
    if (!wasOpen || isOpen || !selectedFile?.path || editingPath) return;
    const idx = visibleFiles.findIndex((f) => f.path === selectedFile.path);
    if (idx >= 0) rowVirtualizer.scrollToIndex(idx, { align: 'auto' });
    const activeItem = fileItemRefs.current.get(selectedFile.path);
    if (!activeItem) return;
    window.requestAnimationFrame(() => activeItem.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDeleteFile, selectedFile?.path, editingPath]);

  const formatTime = useFormatTime();
  const unreadLabel = t('sidebar.unread');

  const handleListKeyDown = createSidebarKeyDownHandler({
    editingPath,
    pendingDeleteFile,
    visibleFiles,
    selectedFile,
    fileItemRefs,
    scrollToIndex: rowVirtualizer.scrollToIndex,
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
      <Box style={{ flexShrink: 0 }} px="10px" pt="10px" pb="8px">
        <AppTextInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('sidebar.searchPlaceholder')}
          tone="tertiary"
          leftSection={<Search size={13} />}
          rightSection={isSearching ? (
            <Text component="span" fz="var(--font-size-xs)" c="dimmed" ff="var(--font-mono)" pr={6}>
              {countLabel}
            </Text>
          ) : undefined}
          rightSectionWidth={isSearching ? 64 : undefined}
          variant="default"
          size="xs"
          radius="sm"
        />
      </Box>

      <Box ref={sidebarViewportRef} flex={1} style={{ overflowY: 'auto', padding: '6px 0' }} onKeyDown={handleListKeyDown}>
        {visibleFiles.length === 0 ? (
          <Text
            p="20px 14px"
            c="dimmed"
            fz="var(--font-size-base)"
            ta="center"
          >
            {query
              ? t('sidebar.emptyFiltered')
              : t('sidebar.empty')}
          </Text>
        ) : (
          <Box style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const file = visibleFiles[virtualRow.index];
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
                    padding: '2px 8px',
                  }}
                >
                  <FileItem
                    file={file}
                    selected={selectedFile?.path === file.path}
                    unread={Boolean(unreadFilePaths[file.path])}
                    unreadLabel={unreadLabel}
                    isEditing={editingPath === file.path}
                    editingMode={editingMode}
                    editingText={editingText}
                    setEditingText={setEditingText}
                    onSelect={handleSelect}
                    onOpenMenu={openContextMenu}
                    onCommitEdit={handleCommitEdit}
                    onCancelEdit={handleCancelEdit}
                    formatTime={formatTime}
                    registerItemRef={registerItemRef}
                  />
                </Box>
              );
            })}
          </Box>
        )}
      </Box>

      <ContextMenuPortal
        position={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
        onClose={() => setContextMenu(null)}
      >
        <MMenu.Item
          leftSection={<Edit3 size={13} />}
          rightSection={<Text component="span" fz="var(--font-size-xs)" c="var(--text-muted)" ff="var(--font-mono)">{t('context.shortcut.editH1')}</Text>}
          onClick={() => { void startEditH1(contextMenu!.file); }}
        >
          {t('context.editH1')}
        </MMenu.Item>
        <MMenu.Item
          leftSection={<FolderOpen size={13} />}
          rightSection={<Text component="span" fz="var(--font-size-xs)" c="var(--text-muted)" ff="var(--font-mono)">{t('context.shortcut.showInFolder')}</Text>}
          onClick={() => { void window.electronAPI.showInFolder(contextMenu!.file.path); setContextMenu(null); }}
        >
          {t('context.showInFolder')}
        </MMenu.Item>
        <MMenu.Divider />
        <MMenu.Item
          leftSection={<Trash2 size={13} />}
          color="red"
          rightSection={<Text component="span" fz="var(--font-size-xs)" c="var(--text-muted)" ff="var(--font-mono)">{t('context.shortcut.delete')}</Text>}
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
    </Stack>
  );
};
