import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Stack, Tooltip } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { measureElementKeepLast, observeRectKeepLast } from '../utils/virtualKeepLast';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../store/appStore';
import { useI18nStore } from '../store/i18nStore';
import { noteConversationOpened } from '../store/recapStore';
import { dropQuestionOfRemovedConversation } from '../store/useAgentRunStore';
import type { BatchCaptureFormat, OutputFile } from '../../../shared/types';
import { folderKey } from '../../../shared/conversationFolders';
import { ToolbarIconButton, ToolbarSearchButton } from './PanelToolbar';
import { SidebarActionRow } from './SidebarActionRow';
import { SidebarTop } from './SidebarTop';
import { SettingsFooter } from './ViewNav';
import { SidebarRail } from './SidebarRail';
import { EmptyState } from './EmptyState';
import { WebDialog } from './WebDialog';
import { GroupHeader } from './GroupHeader';
import { Download, FolderPlus, MessageSquare, PanelLeftClose, SquarePen } from 'lucide-react';
import { BatchExportStrip } from './sidebar/BatchExportStrip';
import { useBatchExport } from './sidebar/useBatchExport';
import { fileApi } from '../api/electronApi';
import { categoryAiSource } from '../../../shared/aiName';
import { FileItem } from './sidebar/FileItem';
import { FileContextMenu } from './sidebar/FileContextMenu';
import { useSidebarFileActions } from './sidebar/useSidebarFileActions';
import { useConversationTrash } from './sidebar/useConversationTrash';
import { useConversationMenuBridge } from './sidebar/conversationMenuBridge';
import { RecentlyDeletedRow } from './sidebar/RecentlyDeletedRow';
import { RecentlyDeletedDialog } from './sidebar/RecentlyDeletedDialog';
import { fillTemplate } from '../../../shared/fillTemplate';
import { pathsToDrag, useConversationImport } from './sidebar/useConversationImport';
import { SidebarImportMenu } from './sidebar/SidebarImportMenu';
import { SidebarFilterMenu } from './sidebar/SidebarFilterMenu';
import { FolderRow } from './sidebar/FolderRow';
import { SectionRow } from './sidebar/SectionRow';
import { SectionActionButton } from './sidebar/SectionActionButton';
import { FolderContextMenu } from './sidebar/FolderMenus';
import { SidebarSelectionBar, SelectionContextMenu } from './sidebar/SidebarSelection';
import { folderLabel } from './sidebar/folderActions';
import { useConversationFolders } from './sidebar/useConversationFolders';
import { useFolderDrop } from './sidebar/useFolderDrop';
import { FileDropZone } from './chat/FileDropZone';
import { markInternalFileDrag } from '../utils/internalFileDrag';
import { createSidebarKeyDownHandler, folderKeyActionsFor } from './sidebar/sidebarKeyNav';
import { useMultiSelect } from '../hooks/useMultiSelect';
import { useConversationMoves } from '../store/conversationMoves';
import { useSidebarViewStore } from '../store/sidebarViewStore';
import { movedPathFor } from '../../../shared/conversationMove';
import { useReloadOpenConversation } from '../hooks/useReloadOpenConversation';
import { useFormatTime } from '../hooks/useFormatTime';
import { useScrollEdgeFade } from '../hooks/useScrollEdgeFade';
import { buildSidebarRows, focusableRowKeys, sectionOfFile, sidebarRowKey } from '../utils/timeGroups';
import type { SidebarSectionKey } from '../utils/timeGroups';
import { folderRowKey } from '../utils/sidebarOrder';
import { useSidebarLayoutStore } from '../store/sidebarLayoutStore';
import { useSidebarDrawerStore } from '../store/sidebarDrawerStore';
import { useNarrowWindow } from '../hooks/useNarrowWindow';
import { providerIconFor } from '../config/providerIcons';
import type { ModelIcon } from '../config/models';
import type { MenuAnchor } from './RowMoreButton';
import { useSelectionActions } from './sidebar/useSelectionActions';
import { containsActiveElement } from '../utils/domUtils';
import { useResolvedCombo } from '../store/shortcutStore';
import { comboLabel } from '../../../shared/shortcuts';
import { isMac } from '../utils/keyLabels';
import { useShortcutAction } from '../shortcuts/useShortcutAction';

interface SidebarProps {
  onNewConversation: () => void;
  onOpenSearch: () => void;
  /** A click (not the keyboard) opened this file: the caret should follow to its input box. */
  onOpenedByClick?: (path: string) => void;
}

// One-line rows (32px and the 2px above and below), as ChatGPT's, Claude's and Perplexity's.
const FILE_ROW_HEIGHT = 36;
const HEADER_ROW_HEIGHT = 26;
const SECTION_ROW_HEIGHT = 32;
// Space above every section heading but the first, so the sections read as three blocks.
const SECTION_GAP = 10;
const FOLDER_ROW_HEIGHT = 36;
// Group labels start in the same column as the rows' leading icons (provider marks, folder icons):
// the row inset plus the `.fileItem` left border and left padding in Sidebar.module.css.
const ROW_INSET = 8;
const HEADER_INSET = 18;
// A conversation drawn inside a folder sits one step in: its mark starts under the folder's name
// (the row inset, `.folderItem`'s left padding, FolderRow's 15px icon and 8px gap, less the
// `.fileItem` left padding).
const FOLDER_CHILD_INSET = 31;

export const Sidebar: React.FC<SidebarProps> = ({ onNewConversation, onOpenSearch, onOpenedByClick }) => {
  const { files, selectedFile, selectFile, setFileContent, setFiles, unreadFilePaths, byokModels, byokGroupModels } = useAppStore(
    useShallow((s) => ({
      files: s.files,
      selectedFile: s.selectedFile,
      selectFile: s.selectFile,
      setFileContent: s.setFileContent,
      setFiles: s.setFiles,
      unreadFilePaths: s.unreadFilePaths,
      byokModels: s.byokModels,
      byokGroupModels: s.byokGroupModels,
    })),
  );
  const {
    collapsedSections, storedCollapsed, providerFilter: chosenProvider,
    setSectionCollapsed, toggleSection, setStoredCollapsed, toggleStoredCollapsed, setProviderFilter,
  } = useSidebarLayoutStore(
    useShallow((s) => ({
      collapsedSections: s.collapsedSections,
      storedCollapsed: s.collapsed,
      providerFilter: s.providerFilter,
      setSectionCollapsed: s.setSectionCollapsed,
      toggleSection: s.toggleSection,
      setStoredCollapsed: s.setCollapsed,
      toggleStoredCollapsed: s.toggleCollapsed,
      setProviderFilter: s.setProviderFilter,
    })),
  );
  // A narrow window has the sidebar as a drawer (`SidebarDrawer`), whole, never the rail: there
  // showing it opens the drawer and folding it closes the drawer. The rail stays the user's choice
  // for a wide window, kept as it was.
  const narrowWindow = useNarrowWindow();
  const { setDrawerOpen, toggleDrawer } = useSidebarDrawerStore(
    useShallow((s) => ({ setDrawerOpen: s.setOpen, toggleDrawer: s.toggle })),
  );
  const sidebarCollapsed = storedCollapsed && !narrowWindow;
  const setSidebarCollapsed = useCallback((collapsed: boolean): void => {
    if (narrowWindow) setDrawerOpen(!collapsed);
    else setStoredCollapsed(collapsed);
  }, [narrowWindow, setDrawerOpen, setStoredCollapsed]);
  const toggleSidebar = narrowWindow ? toggleDrawer : toggleStoredCollapsed;
  const { t, locale } = useI18nStore(useShallow((s) => ({ t: s.t, locale: s.locale })));
  const selection = useMultiSelect();
  // Rows moved into a folder stay ticked.
  useConversationMoves((moves) => selection.rename((id) => movedPathFor(moves, id) ?? id));
  const fileItemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const sidebarViewportRef = useRef<HTMLDivElement>(null);
  const fadeClass = useScrollEdgeFade(sidebarViewportRef, sidebarCollapsed);

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
      dropQuestionOfRemovedConversation(nextFiles.map((file) => file.path));
    });
    return unsub;
  }, [loadFiles, setFiles]);

  useReloadOpenConversation();

  const newChatCombo = useResolvedCombo('chat.newConversation');

  const folderState = useConversationFolders(files, selectedFile?.path ?? null, t);
  const { folders, open: openFolders } = folderState;
  // The ✨ in a category's rename box names it from the conversations in it.
  const renamingFolderAi = useMemo(() => {
    const name = folderState.renaming;
    if (!name) return null;
    const titles = files.filter((file) => file.folder === name).map((file) => file.preview);
    return categoryAiSource('chat', name, titles, folders.map((folder) => folder.name));
  }, [folderState.renaming, files, folders]);
  const view = useSidebarViewStore((s) => s.view);
  const compareTitles = useMemo(() => new Intl.Collator(locale, { numeric: true, sensitivity: 'base' }).compare, [locale]);

  // Pinned first (latest activity), then the folders, then the top-level conversations in the
  // chosen order (one model's, when filtered); a closed folder's or section's conversations are not
  // drawn. Keys, ↑↓ and Shift ranges walk the same drawn order.
  const { rows, rowIndexByFileIndex, visibleFiles, providers, providerFilter } = useMemo(() => buildSidebarRows(files, new Date(), {
    folders, expanded: openFolders, view, compareTitles, folderLabel: (folder) => folderLabel(folder.name, t),
    collapsed: collapsedSections, provider: chosenProvider,
  }), [files, folders, openFolders, view, compareTitles, t, collapsedSections, chosenProvider]);

  // The open conversation is never hidden in a closed section: opening it — or pinning it, filing
  // it in a folder — opens the section it is drawn in. Closing the section afterwards is left alone.
  // Opening one the model filter hides (from Ctrl+K, a new chat on another model) clears the filter
  // the same way; filtering while it is open leaves it open and unlisted.
  const openFile = selectedFile ? files.find((file) => file.path === selectedFile.path) ?? null : null;
  const openSection: SidebarSectionKey | null = openFile ? sectionOfFile(openFile) : null;
  useEffect(() => {
    if (openSection) setSectionCollapsed(openSection, false);
    if (openSection === 'conversations' && providerFilter && openFile?.provider !== providerFilter) setProviderFilter(null);
  }, [selectedFile?.path, openSection, setSectionCollapsed]);

  // Whose answer each row holds: the model menu's own icons, matched by the name in the file.
  const flowLabel = t('chat.command.providerLabel');
  const providerIcon = useMemo(() => {
    const extra = [...byokModels, ...byokGroupModels];
    const cache = new Map<string, ModelIcon>();
    return (provider: string | undefined): ModelIcon => {
      const key = provider ?? '';
      const hit = cache.get(key);
      if (hit) return hit;
      const icon = providerIconFor(provider, extra, flowLabel);
      cache.set(key, icon);
      return icon;
    };
  }, [byokModels, byokGroupModels, flowLabel]);
  const selectableIds = useMemo(() => visibleFiles.map((f) => f.path), [visibleFiles]);
  const navKeys = useMemo(() => focusableRowKeys(rows), [rows]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => sidebarViewportRef.current,
    estimateSize: (index) => {
      const kind = rows[index]?.kind;
      if (kind === 'header') return HEADER_ROW_HEIGHT;
      if (kind === 'section') return SECTION_ROW_HEIGHT + (index > 0 ? SECTION_GAP : 0);
      return kind === 'folder' ? FOLDER_ROW_HEIGHT : FILE_ROW_HEIGHT;
    },
    getItemKey: (index) => {
      const row = rows[index];
      return row ? sidebarRowKey(row) : index;
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

  const scrollToKey = useCallback((key: string) => {
    const index = rows.findIndex((row) => sidebarRowKey(row) === key);
    if (index >= 0) rowVirtualizer.scrollToIndex(index, { align: 'auto' });
  }, [rows, rowVirtualizer]);

  // A folder being renamed in place (a new one too) is shown — the sidebar unfolded, the folders
  // section opened — and scrolled into view, or its field would be unseen. It runs again as the
  // rows catch up with the opened section.
  useEffect(() => {
    if (!folderState.renaming) return;
    setSidebarCollapsed(false);
    setSectionCollapsed('folders', false);
    scrollToKey(folderRowKey(folderState.renaming));
  }, [folderState.renaming, rows]);

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
    if (result !== 'open') return;
    // A click opens it ready to type into; Enter from the keyboard (onSelect) keeps focus in the list.
    onOpenedByClick?.(file.path);
    void handleSelect(file);
  }, [selection, selectableIds, handleSelect, onOpenedByClick]);

  const handleImportFiles = useConversationImport(handleSelect);
  // A Notion import names its file; the list main broadcast has the row to open.
  const handleOpenImported = useCallback((path: string): void => {
    void fileApi.getList().then((list) => {
      const file = list.find((entry) => entry.path === path);
      if (file) void handleSelect(file);
    });
  }, [handleSelect]);

  const handleDragOut = useCallback((file: OutputFile) => {
    const paths = pathsToDrag(file.path, selection.selectMode, selection.selectedIds, selectableIds);
    // Remembered, so a drop back on a folder row of this list files them instead of importing them.
    markInternalFileDrag(paths);
    fileApi.startDrag(paths);
  }, [selection.selectMode, selection.selectedIds, selectableIds]);
  const drop = useFolderDrop({ files, moveTo: folderState.moveTo });

  useEffect(() => {
    if (!selection.selectMode) selection.setAnchor(selectedFile?.path ?? null);
  }, [selectedFile?.path, selection.selectMode, selection.setAnchor]);

  const trash = useConversationTrash({
    visibleFiles, selectedFile, selectFile, setFileContent, onSelect: handleSelect,
    viewportRef: sidebarViewportRef, fileItemRefs, getFocusedFile,
  });

  // No confirmation: the batch goes to Recently Deleted and the notice can bring it back.
  const handleBulkDelete = useCallback(async () => {
    const paths = visibleFiles.filter((file) => selection.selectedIds.has(file.path)).map((file) => file.path);
    if (paths.length === 0) return;
    selection.exit();
    await trash.deleteConversations(paths, false);
  }, [visibleFiles, selection, trash.deleteConversations]);

  useShortcutAction('files.delete', () => {
    if (!selection.selectMode || selection.count === 0) return;
    void handleBulkDelete();
  }, 'chat');

  const {
    editingPath, editingText, setEditingText,
    contextMenu, setContextMenu,
    openContextMenu, startEditH1, startDelete,
    handleCommitEdit, handleCancelEdit,
  } = useSidebarFileActions({
    selectedFile, setFileContent, loadFiles, deleteConversations: trash.deleteConversations,
  });
  const closeContextMenu = useCallback(() => setContextMenu(null), [setContextMenu]);
  // The row's "⋯" opens the very menu a right-click does, under the button; again closes it.
  const handleOpenMenuAt = useCallback((file: OutputFile, at: MenuAnchor) => {
    setContextMenu((current) => (current?.file.path === file.path ? null : { ...at, file }));
  }, [setContextMenu]);

  // Main writes the pin into each file and broadcasts the list; the rows follow that broadcast.
  const setPinned = useCallback((paths: string[], pinned: boolean) => {
    if (paths.length === 0) return;
    void fileApi.setPinned(paths, pinned);
  }, []);
  const handleTogglePin = useCallback((file: OutputFile) => {
    setPinned([file.path], !file.pinned);
  }, [setPinned]);

  const batch = useBatchExport();
  const exportOneCard = useCallback((format: BatchCaptureFormat, file: OutputFile) => {
    void batch.exportCards(format, [file]);
  }, [batch.exportCards]);
  const picked = useSelectionActions({
    selectMode: selection.selectMode, selectedIds: selection.selectedIds, visibleFiles, setPinned,
    exportZip: batch.exportZip, exportCards: batch.exportCards,
    moveTo: folderState.moveTo, createFolder: folderState.createFolder, t,
  });
  const { pickedFiles, setSelectionMenu } = picked;
  const selectionProps = {
    picked: pickedFiles, folders, selectionPin: picked.selectionPin, onPin: picked.pinSelection,
    onAction: picked.runSelectionAction, onMove: picked.moveSelection, onMoveToNew: picked.moveSelectionToNew,
    onDelete: () => { void handleBulkDelete(); }, t,
  };

  // macOS menu bar › Conversation: the same handlers as the context menu, on the open conversation.
  // The whole list, not the drawn rows: the open conversation may sit in a folder closed since.
  useConversationMenuBridge({
    selectedFile, files, onNewConversation, onTogglePin: handleTogglePin,
    onEditTitle: startEditH1, onExportCards: exportOneCard, onDelete: startDelete,
    folders, onMoveToFolder: folderState.moveTo, onMoveToNewFolder: folderState.createFolder,
  });

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

  const permanentOpen = Boolean(trash.pendingPermanent);
  useEffect(() => {
    if (!selectedFile?.path || permanentOpen || editingPath) return;
    const idx = visibleFiles.findIndex((f) => f.path === selectedFile.path);
    if (idx >= 0) scrollToFileIndex(idx);
    if (!containsActiveElement(sidebarViewportRef.current)) return;
    const activeItem = fileItemRefs.current.get(selectedFile.path);
    if (!activeItem || document.activeElement === activeItem) return;
    window.requestAnimationFrame(() => {
      fileItemRefs.current.get(selectedFile.path ?? '')?.focus();
    });
  }, [selectedFile?.path, permanentOpen, editingPath]);

  // A title edit started from the menu bar may be on a row scrolled out of the virtual list, in a
  // closed section, or in a folded sidebar: its field is shown either way.
  useEffect(() => {
    if (!editingPath) return;
    setSidebarCollapsed(false);
    const editing = files.find((f) => f.path === editingPath);
    if (editing) setSectionCollapsed(sectionOfFile(editing), false);
    const idx = visibleFiles.findIndex((f) => f.path === editingPath);
    if (idx >= 0) scrollToFileIndex(idx);
  }, [editingPath, visibleFiles, sidebarCollapsed]);

  // Folding the sidebar ends a selection (Delete would otherwise act on rows nobody can see) and
  // closes a row's menu, which would otherwise come back at its old place on unfolding.
  useEffect(() => {
    if (!sidebarCollapsed) return;
    if (selection.selectMode) selection.exit();
    closeContextMenu();
    folderState.closeFolderMenu();
  }, [sidebarCollapsed]);

  useShortcutAction('view.toggleSidebar', toggleSidebar, 'chat');
  const toggleSidebarCombo = comboLabel(useResolvedCombo('view.toggleSidebar'), isMac);
  const withCombo = (label: string): string => (toggleSidebarCombo ? `${label} (${toggleSidebarCombo})` : label);

  const formatTime = useFormatTime();
  const unreadLabel = t('sidebar.unread');
  const turnsLabel = t('chat.turns');
  // The hover card's second line: provider · time · turns. The time carries its own day ("Mon
  // 09:04"), since the card is read away from the time-group heading.
  const rowDetail = (file: OutputFile, time: string): string => [
    file.provider,
    formatTime(time),
    (file.turns ?? 1) > 1 ? fillTemplate(turnsLabel, { count: String(file.turns) }) : '',
  ].filter(Boolean).join(' · ');
  const moreLabel = t('common.moreActions');
  const openMenuPath = contextMenu?.file.path ?? null;
  const swipeMore = t('rowSwipe.more');
  const swipeDelete = t('common.delete');
  const swipePin = t('context.pin');
  const swipeUnpin = t('context.unpin');
  const swipeLabels = useMemo(
    () => ({ more: swipeMore, delete: swipeDelete, pin: swipePin, unpin: swipeUnpin }),
    [swipeMore, swipeDelete, swipePin, swipeUnpin],
  );
  const folderKeys = useMemo(() => folderKeyActionsFor(rows, openFolders, {
    setOpen: folderState.setFolderOpen, renameFolder: folderState.startRename, deleteFolder: folderState.deleteFolder,
  }), [rows, openFolders, folderState.setFolderOpen, folderState.startRename, folderState.deleteFolder]);
  // The folders heading drawn before the first folder has nothing to fold; its keys do nothing.
  const foldersEmpty = rows.some((row) => row.kind === 'section' && row.key === 'folders' && row.empty);
  const sectionKeys = useMemo(() => ({
    isCollapsed: (section: SidebarSectionKey) => collapsedSections.has(section),
    setCollapsed: (section: SidebarSectionKey, collapsed: boolean) => {
      if (section === 'folders' && foldersEmpty) return;
      setSectionCollapsed(section, collapsed);
    },
  }), [collapsedSections, setSectionCollapsed, foldersEmpty]);
  const newFolderLabel = t('sidebar.folder.new');
  const startNewFolder = useCallback(() => { void folderState.createFolder(); }, [folderState.createFolder]);
  // What each heading carries at its right end: a new folder, the conversations' filter.
  const sectionActions = (key: SidebarSectionKey): React.ReactNode => {
    if (key === 'folders') return <SectionActionButton icon={FolderPlus} label={newFolderLabel} onClick={startNewFolder} />;
    if (key !== 'conversations') return null;
    return (
      <SidebarFilterMenu
        providers={providers}
        providerFilter={providerFilter}
        onProviderFilter={setProviderFilter}
        providerIcon={providerIcon}
        t={t}
      />
    );
  };

  const handleListKeyDown = createSidebarKeyDownHandler({
    editingPath: editingPath ?? folderState.renaming,
    dialogOpen: permanentOpen || trash.dialogOpen,
    visibleFiles,
    navKeys,
    fileItemRefs,
    scrollToKey,
    scrollToIndex: scrollToFileIndex,
    getFocusedFile,
    onSelect: handleSelect,
    onEditH1: startEditH1,
    onDelete: startDelete,
    onTogglePin: handleTogglePin,
    onCloseContextMenu: closeContextMenu,
    folders: folderKeys,
    sections: sectionKeys,
  });

  const sidebarStyle = { borderRight: '1px solid var(--mantine-color-default-border)', overflow: 'hidden', position: 'relative' } as const;

  // Mounted whether or not the sidebar is folded: the menu bar can delete or restore from either.
  const dialogs = (
    <>
      {/* Only when a file could not be moved to Recently Deleted: deleting it is then for good. */}
      <WebDialog
        open={permanentOpen}
        title={t('trash.permanent.title')}
        description={fillTemplate(t('trash.permanent.body'), { count: trash.pendingPermanent?.paths.length ?? 0 })}
        confirmText={t('trash.permanent.confirm')}
        cancelText={t('dialog.cancel')}
        danger
        onConfirm={() => { void trash.confirmPermanent(); }}
        onCancel={trash.cancelPermanent}
      />

      <RecentlyDeletedDialog opened={trash.dialogOpen} onClose={trash.closeDialog} />
    </>
  );

  // Folded: the icon rail (`SidebarRail`) with a new chat and search, Flow at its foot.
  if (sidebarCollapsed) {
    return (
      <FileDropZone
        onFiles={handleImportFiles}
        icon={Download}
        title={t('sidebar.import.dropTitle')}
        detail={t('sidebar.import.dropDetail')}
      >
        <SidebarRail expandLabel={withCombo(t('sidebar.expand'))} onExpand={toggleSidebar} otherView="flow" extra={dialogs}>
          <ToolbarIconButton
            icon={SquarePen}
            label={newChatCombo ? `${t('chat.new')} (${comboLabel(newChatCombo, isMac)})` : t('chat.new')}
            onClick={onNewConversation}
          />
          <ToolbarSearchButton label={t('sidebar.search.tooltip')} onClick={onOpenSearch} />
        </SidebarRail>
      </FileDropZone>
    );
  }

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
      style={sidebarStyle}
    >
      <SidebarTop
        action={(
          <Tooltip label={comboLabel(newChatCombo, isMac)} position="bottom" disabled={!newChatCombo}>
            <SidebarActionRow
              icon={SquarePen}
              label={t('chat.new')}
              onClick={onNewConversation}
              trailing={<SidebarImportMenu onPickFiles={handleImportFiles} onOpenImported={handleOpenImported} t={t} />}
            />
          </Tooltip>
        )}
      >
        <ToolbarSearchButton label={t('sidebar.search.tooltip')} onClick={onOpenSearch} />
        <ToolbarIconButton icon={PanelLeftClose} label={withCombo(t('sidebar.collapse'))} onClick={toggleSidebar} />
      </SidebarTop>

      <Box
        ref={sidebarViewportRef}
        flex={1}
        className={fadeClass}
        style={{ overflowY: 'auto', padding: '6px 0' }}
        onKeyDown={selection.selectMode ? undefined : handleListKeyDown}
        {...drop.listDropProps}
      >
        {rows.length === 0 ? (
          <EmptyState icon={MessageSquare} label={t('sidebar.empty')} busy={!filesLoaded} />
        ) : (
          <Box style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) return null;
              let padding = `2px ${ROW_INSET}px`;
              if (row.kind === 'header') padding = `0 ${ROW_INSET}px 0 ${HEADER_INSET}px`;
              else if (row.kind === 'section') padding = `${virtualRow.index > 0 ? SECTION_GAP : 0}px ${ROW_INSET}px 0`;
              else if (row.kind === 'file' && row.inFolder) padding = `2px ${ROW_INSET}px 2px ${FOLDER_CHILD_INSET}px`;
              return (
                <Box
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  {...drop.rowDropProps(row)}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                    padding,
                  }}
                >
                  {row.kind === 'file' && (
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
                      onOpenMenuAt={handleOpenMenuAt}
                      menuOpen={openMenuPath === row.file.path}
                      moreLabel={moreLabel}
                      onDragOut={handleDragOut}
                      onDelete={startDelete}
                      onTogglePin={handleTogglePin}
                      swipeLabels={swipeLabels}
                      onCommitEdit={handleCommitEdit}
                      onCancelEdit={handleCancelEdit}
                      providerIcon={providerIcon(row.file.provider)}
                      detail={rowDetail(row.file, row.time)}
                      registerItemRef={registerItemRef}
                    />
                  )}
                  {row.kind === 'section' && (
                    <SectionRow
                      section={row.key}
                      label={t(`sidebar.section.${row.key}`)}
                      collapsed={row.collapsed}
                      empty={row.empty}
                      detail={row.key === 'conversations' ? providerFilter ?? undefined : undefined}
                      actions={sectionActions(row.key)}
                      onToggle={toggleSection}
                      registerItemRef={registerItemRef}
                    />
                  )}
                  {row.kind === 'folder' && (
                    <FolderRow
                      folder={row.folder}
                      label={folderLabel(row.folder.name, t)}
                      count={row.count}
                      expanded={row.expanded}
                      isRenaming={folderState.renaming === row.folder.name}
                      renameText={folderState.renameText}
                      setRenameText={folderState.setRenameText}
                      onCommitRename={folderState.commitRename}
                      onCancelRename={folderState.cancelRename}
                      aiSource={folderState.renaming === row.folder.name ? renamingFolderAi : null}
                      menuOpen={folderState.folderMenu?.folder.name === row.folder.name}
                      moreLabel={moreLabel}
                      dropTarget={drop.overFolder === folderKey(row.folder.name)}
                      onToggle={folderState.toggleFolder}
                      onOpenMenu={folderState.openFolderMenu}
                      onOpenMenuAt={folderState.openFolderMenuAt}
                      registerItemRef={registerItemRef}
                    />
                  )}
                  {row.kind === 'header' && <GroupHeader variant="sub" label={t(`sidebar.group.${row.key}`)} />}
                </Box>
              );
            })}
          </Box>
        )}
        {trash.count > 0 && (
          <Box px={ROW_INSET} pt={6}>
            <RecentlyDeletedRow count={trash.count} label={t('trash.title')} onOpen={trash.openDialog} />
          </Box>
        )}
      </Box>

      <BatchExportStrip state={batch.state} onStop={batch.stop} onDismiss={batch.dismiss} t={t} />

      {selection.selectMode && !batch.running && (
        <SidebarSelectionBar
          count={picked.count}
          allSelected={selection.allSelected(selectableIds)}
          onToggleAll={() => selection.toggleAll(selectableIds)}
          onCancel={selection.exit}
          {...selectionProps}
        />
      )}
      <SettingsFooter />

      <SelectionContextMenu position={picked.selectionMenu} onClose={picked.closeSelectionMenu} busy={batch.running} {...selectionProps} />

      <FileContextMenu
        menu={contextMenu}
        onClose={closeContextMenu}
        t={t}
        canSelectMultiple={visibleFiles.length >= 2}
        exportBusy={batch.running}
        onEditH1={startEditH1}
        onTogglePin={handleTogglePin}
        onStartSelection={handleStartSelection}
        onDelete={startDelete}
        onExportCards={exportOneCard}
        folders={folders}
        onMoveTo={(file, folder) => { void folderState.moveTo([file.path], folder); }}
        onMoveToNewFolder={(file) => { void folderState.createFolder([file.path]); }}
      />

      <FolderContextMenu
        menu={folderState.folderMenu}
        onClose={folderState.closeFolderMenu}
        onRename={folderState.startRename}
        onDelete={folderState.deleteFolder}
        t={t}
      />

      {dialogs}
    </Stack>
    </FileDropZone>
  );
};
