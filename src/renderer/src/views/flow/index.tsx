import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Flex, Menu, Stack,
} from '@mantine/core';
import {
  ArrowDown, ArrowUp, ChevronDown, Copy, Download, ListChecks, PanelLeftClose, Pencil, Play, Plus, Power, PowerOff, Sparkles, Trash,
  Upload,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useI18nStore } from '../../store/i18nStore';
import { useFlowStore } from '../../store/useFlowStore';
import { useFlowOutlineStore } from '../../store/useFlowOutlineStore';
import { flowApi, ipcEvents } from '../../api/electronApi';
import { CaptionStrip, ToolbarIconButton, ToolbarSearchButton } from '../../components/PanelToolbar';
import { SidebarActionRow } from '../../components/SidebarActionRow';
import { SidebarTop } from '../../components/SidebarTop';
import { SettingsFooter } from '../../components/ViewNav';
import { SidebarRail } from '../../components/SidebarRail';
import { useSidebarLayoutStore } from '../../store/sidebarLayoutStore';
import { useSidebarDrawerStore } from '../../store/sidebarDrawerStore';
import { comboLabel } from '../../../../shared/shortcuts';
import { isMac } from '../../utils/keyLabels';
import { SidebarDrawer, SidebarDrawerButton } from '../../components/SidebarDrawer';
import { useNarrowWindow } from '../../hooks/useNarrowWindow';
import { AppButton } from '../../components/AppButton';
import { WebDialog } from '../../components/WebDialog';
import { ContextMenuPortal } from '../../components/ContextMenuPortal';
import { ShortcutHint } from '../../components/ShortcutHint';
import { SelectionActionBar } from '../../components/SelectionActionBar';
import { useMultiSelect } from '../../hooks/useMultiSelect';
import type { FlowDefinition } from '../../../../shared/types';
import { FlowSidebarList } from './FlowSidebarList';
import { FlowSearchOverlay } from './FlowSearchOverlay';
import { FlowEditor } from './FlowEditor';
import { FlowDropzone } from './FlowDropzone';
import { FlowTemplatesModal } from './FlowTemplatesModal';
import { FlowSetupWizard } from './FlowSetupWizard';
import { FlowImportModal } from './FlowImportModal';
import { FlowPreviewConfirm } from './FlowPreviewConfirm';
import type { FlowTemplate } from './examples';
import { FlowGenerateModal } from './FlowGenerateModal';
import { FlowRenameModal } from './FlowRenameModal';
import { FlowHome } from './FlowHome';
import { YtdlToolsDialog } from '../../components/ytdl/YtdlToolsDialog';
import { Z_POPOVER } from '../../config/zLayers';
import { useShortcutAction } from '../../shortcuts/useShortcutAction';
import { useResolvedCombo } from '../../store/shortcutStore';
import type { MenuAnchor } from '../../components/RowMoreButton';
import { fillTemplate } from '../../../../shared/fillTemplate';
import type { ConversationFolder } from '../../../../shared/conversationFolders';
import { MoveToFolderButton, MoveToFolderSub } from '../../components/sidebar/FolderMenus';
import { useFlowFolderStore } from '../../store/flowFolderStore';
import { FlowFolderMenu } from './FlowFolderMenu';
import { FlowFolderSortModal } from './FlowFolderSortModal';
import type { FlowFolderRowUi } from './FlowSidebarList';
import { useFlowFolders } from './useFlowFolders';
import {
  buildFlowSidebarRows, flowSiblings, folderOfFlow, swapInOrder, visibleFlowIds,
} from './flowSidebarRows';

/** Flow folders are labels: each is shown as named (never as a chat system folder's translation). */
const ownName = (name: string): string => name;

export const FlowView: React.FC = () => {
  const { t, locale } = useI18nStore(useShallow((s) => ({ t: s.t, locale: s.locale })));
  const narrowWindow = useNarrowWindow();
  const {
    flows, selectedFlowId, runningFlowIds,
    selectFlow, createFlow, deleteFlow, deleteFlows, setFlowsEnabled, duplicateFlow,
    saveFlow, updateFlow, reorderFlows, executeFlow, importFlows, buildFlow,
    adoptFlow, replaceSavedFlow, dropRemovedFlow, appendExecutionLog, markFlowRunning, markFlowDone,
  } = useFlowStore(
    useShallow((s) => ({
      flows: s.flows,
      selectedFlowId: s.selectedFlowId,
      runningFlowIds: s.runningFlowIds,
      selectFlow: s.selectFlow,
      createFlow: s.createFlow,
      deleteFlow: s.deleteFlow,
      deleteFlows: s.deleteFlows,
      setFlowsEnabled: s.setFlowsEnabled,
      duplicateFlow: s.duplicateFlow,
      saveFlow: s.saveFlow,
      updateFlow: s.updateFlow,
      reorderFlows: s.reorderFlows,
      executeFlow: s.executeFlow,
      importFlows: s.importFlows,
      buildFlow: s.buildFlow,
      adoptFlow: s.adoptFlow,
      replaceSavedFlow: s.replaceSavedFlow,
      dropRemovedFlow: s.dropRemovedFlow,
      appendExecutionLog: s.appendExecutionLog,
      markFlowRunning: s.markFlowRunning,
      markFlowDone: s.markFlowDone,
    })),
  );

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; flowId: string } | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [wizardTemplate, setWizardTemplate] = useState<FlowTemplate | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generateSeed, setGenerateSeed] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const selection = useMultiSelect();
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<FlowDefinition[] | null>(null);

  const requestImport = useCallback((incoming: FlowDefinition[]) => {
    if (incoming.length === 0) return;
    setImportOpen(false);
    setPendingImport(incoming);
  }, []);

  const confirmImport = useCallback((approved: FlowDefinition[]) => {
    setPendingImport(null);
    void importFlows(approved);
  }, [importFlows]);

  useEffect(() => {
    const unsub = ipcEvents.onFlowExecutionLog((log) => { appendExecutionLog(log); });
    return unsub;
  }, [appendExecutionLog]);

  useEffect(() => {
    const unsubStart = ipcEvents.onFlowExecutionStarted((evt) => markFlowRunning(evt.flowId));
    const unsubEnd = ipcEvents.onFlowExecutionEnded((evt) => markFlowDone(evt.flowId));
    return () => { unsubStart(); unsubEnd(); };
  }, [markFlowRunning, markFlowDone]);

  useEffect(() => ipcEvents.onFlowCreated((flow) => adoptFlow(flow)), [adoptFlow]);
  useEffect(() => ipcEvents.onFlowUpdated((flow) => replaceSavedFlow(flow)), [replaceSavedFlow]);
  useEffect(() => ipcEvents.onFlowRemoved((flowId) => dropRemovedFlow(flowId)), [dropRemovedFlow]);

  const renameCombo = useResolvedCombo('flow.rename');
  const duplicateCombo = useResolvedCombo('flow.duplicate');
  const deleteCombo = useResolvedCombo('flow.delete');

  useShortcutAction('nav.quickSwitch', () => {
    if (selection.selectMode) return;
    setSearchOpen(true);
  }, 'flow');

  // With a flow open, finding means finding one of its steps (the outline's search); otherwise a flow.
  useShortcutAction('nav.find', () => {
    if (selection.selectMode) return;
    if (selectedFlowId) {
      useFlowOutlineStore.getState().requestSearchFocus();
      return;
    }
    setSearchOpen(true);
  }, 'flow');

  useShortcutAction('flow.rename', () => {
    if (selection.selectMode || !selectedFlowId) return;
    setRenameId(selectedFlowId);
  }, 'flow');

  useShortcutAction('flow.duplicate', () => {
    if (selection.selectMode || !selectedFlowId) return;
    void duplicateFlow(selectedFlowId);
  }, 'flow');

  useShortcutAction('flow.delete', () => {
    if (selection.selectMode) {
      if (selection.count > 0) setBulkDeleteOpen(true);
      return;
    }
    if (!selectedFlowId) return;
    setPendingDeleteId(selectedFlowId);
  }, 'flow');

  useEffect(() => {
    if (!selection.selectMode) selection.setAnchor(selectedFlowId ?? null);
  }, [selectedFlowId, selection.selectMode, selection.setAnchor]);

  const selectedFlow = useMemo(
    () => flows.find((f) => f.id === selectedFlowId) ?? null,
    [flows, selectedFlowId],
  );

  const folderState = useFlowFolders(selectedFlowId, t);
  const { folders } = folderState;
  const { open: openFolders, collapsed } = useFlowFolderStore(useShallow((s) => ({ open: s.open, collapsed: s.collapsed })));
  const compareNames = useMemo(() => new Intl.Collator(locale, { numeric: true, sensitivity: 'base' }).compare, [locale]);
  const rows = useMemo(
    () => buildFlowSidebarRows(flows, folders, { open: openFolders, collapsed, compareNames }),
    [flows, folders, openFolders, collapsed, compareNames],
  );
  // The move menus take conversation folders; flow folders are never system ones.
  const menuFolders = useMemo<ConversationFolder[]>(() => folders.map((folder) => ({ name: folder.name, system: false })), [folders]);
  const folderOf = useCallback((flowId: string) => ({ folder: folderOfFlow(folders, flowId) || undefined }), [folders]);
  const unfiledCount = useMemo(() => {
    const filed = new Set(folders.flatMap((folder) => folder.flowIds));
    return flows.filter((flow) => !filed.has(flow.id)).length;
  }, [flows, folders]);
  const [sortOpen, setSortOpen] = useState(false);

  const openSearch = useCallback((): void => setSearchOpen(true), []);

  // Folded to the icon rail like the chat sidebar, with its own remembered choice. A narrow
  // window has the sidebar as a drawer, whole, never the rail: there the fold opens and closes it.
  const { storedRail, toggleStoredRail } = useSidebarLayoutStore(useShallow((s) => ({
    storedRail: s.flowCollapsed, toggleStoredRail: s.toggleFlowCollapsed,
  })));
  const toggleDrawer = useSidebarDrawerStore((s) => s.toggle);
  const railed = storedRail && !narrowWindow;
  const toggleSidebar = narrowWindow ? toggleDrawer : toggleStoredRail;
  useShortcutAction('view.toggleSidebar', toggleSidebar, 'flow');
  const toggleSidebarCombo = comboLabel(useResolvedCombo('view.toggleSidebar'), isMac);
  const withCombo = (label: string): string => (toggleSidebarCombo ? `${label} (${toggleSidebarCombo})` : label);
  // Folding ends a selection (Delete would act on rows nobody can see) and closes the row and
  // folder menus, which would otherwise come back at their old place on unfolding.
  useEffect(() => {
    if (!railed) return;
    if (selection.selectMode) selection.exit();
    setContextMenu(null);
    folderState.closeFolderMenu();
  }, [railed]);

  const handleDeleteFlow = useCallback(async (flowId: string) => {
    await deleteFlow(flowId);
    setPendingDeleteId(null);
  }, [deleteFlow]);

  const handleDuplicateFlow = useCallback(async (flowId: string) => {
    await duplicateFlow(flowId);
    setContextMenu(null);
  }, [duplicateFlow]);

  const handleRenameFlow = useCallback(async (flowId: string, name: string) => {
    const flow = flows.find((item) => item.id === flowId);
    if (!flow) return;
    const updated = { ...flow, name };
    updateFlow(updated);
    await saveFlow(updated);
  }, [flows, updateFlow, saveFlow]);

  // Up and down pass the neighbour in the same folder (or at the top level), never into another list.
  const neighbourOf = useCallback((flowId: string, direction: 'up' | 'down'): string | null => {
    const siblings = flowSiblings(flows, folders, flowId);
    const index = siblings.indexOf(flowId);
    return siblings[direction === 'up' ? index - 1 : index + 1] ?? null;
  }, [flows, folders]);

  const handleMoveFlow = useCallback(async (flowId: string, direction: 'up' | 'down') => {
    setContextMenu(null);
    const neighbour = neighbourOf(flowId, direction);
    if (!neighbour) return;
    await reorderFlows(swapInOrder(flows.map((flow) => flow.id), flowId, neighbour));
  }, [neighbourOf, flows, reorderFlows]);

  const handleRunFlow = useCallback(async (flowId: string) => {
    const flow = flows.find((item) => item.id === flowId);
    if (!flow) return;
    await saveFlow(flow);
    await executeFlow(flowId);
    setContextMenu(null);
  }, [flows, saveFlow, executeFlow]);

  const handleExportFlow = useCallback(async (flowId: string) => {
    const flow = flows.find((item) => item.id === flowId);
    if (!flow) return;
    await flowApi.exportFlow(flow);
    setContextMenu(null);
  }, [flows]);

  const handleToggleEnabled = useCallback(async (flow: FlowDefinition, enabled: boolean) => {
    const updated = { ...flow, enabled };
    updateFlow(updated);
    await saveFlow(updated);
  }, [updateFlow, saveFlow]);

  // Shift ranges and Select All run over the flows drawn: a closed folder's are skipped.
  const selectableIds = useMemo(() => visibleFlowIds(rows), [rows]);
  const selectedFolders = useMemo(() => [...selection.selectedIds].map(folderOf), [selection.selectedIds, folderOf]);

  const handleRowClick = useCallback((flowId: string, mods: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    const result = selection.selectClick(flowId, {
      ctrlKey: mods.ctrlKey || mods.metaKey,
      shiftKey: mods.shiftKey,
      orderedIds: selectableIds,
    });
    if (result === 'open') selectFlow(flowId);
  }, [selection, selectableIds, selectFlow]);

  const handleStartSelection = useCallback((flowId: string) => {
    selection.enter();
    selection.toggle(flowId);
    selection.setAnchor(flowId);
    setContextMenu(null);
  }, [selection]);

  const handleBulkDelete = useCallback(async () => {
    const ids = [...selection.selectedIds];
    setBulkDeleteOpen(false);
    if (ids.length === 0) return;
    await deleteFlows(ids);
    selection.exit();
  }, [selection, deleteFlows]);

  const handleBulkSetEnabled = useCallback(async (enabled: boolean) => {
    const ids = [...selection.selectedIds];
    if (ids.length === 0) return;
    await setFlowsEnabled(ids, enabled);
  }, [selection, setFlowsEnabled]);

  const openContextMenu = useCallback((e: React.MouseEvent, flowId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, flowId });
  }, []);
  // A row's "⋯" opens the very menu a right-click does, under the button; again closes it.
  const openContextMenuAt = useCallback((flowId: string, at: MenuAnchor) => {
    setContextMenu((current) => (current?.flowId === flowId ? null : { ...at, flowId }));
  }, []);

  const contextFlow = useMemo(
    () => (contextMenu ? flows.find((flow) => flow.id === contextMenu.flowId) ?? null : null),
    [contextMenu, flows],
  );
  const renameFlow = useMemo(
    () => (renameId ? flows.find((flow) => flow.id === renameId) ?? null : null),
    [renameId, flows],
  );

  const folderUi: FlowFolderRowUi = {
    renaming: folderState.renaming,
    renameText: folderState.renameText,
    setRenameText: folderState.setRenameText,
    commitRename: folderState.commitRename,
    cancelRename: folderState.cancelRename,
    menuName: folderState.folderMenu?.name ?? null,
    openMenu: folderState.openFolderMenu,
    openMenuAt: folderState.openFolderMenuAt,
    onToggleFolder: (name) => useFlowFolderStore.getState().toggleOpen(name),
    onToggleSection: (key) => useFlowFolderStore.getState().toggleCollapsed(key),
    onNewFolder: () => { void folderState.createFolder(); },
    ...(unfiledCount > 0 ? { onSmartSort: () => setSortOpen(true) } : {}),
    onMove: (flowIds, folder, before) => { void folderState.moveTo(flowIds, folder, before); },
  };
  const folderMenuFlows = useMemo(() => {
    const ids = new Set(folderState.folderMenu?.flowIds ?? []);
    return flows.filter((flow) => ids.has(flow.id));
  }, [folderState.folderMenu, flows]);

  return (
    <FlowDropzone t={t} onImport={requestImport}>
      {/* Relative: a narrow window's sidebar drawer and its backdrop are placed in this row. */}
      <Flex flex={1} h="100%" pos="relative" style={{ overflow: 'hidden' }}>
        <SidebarDrawer selection={selectedFlowId}>
        <Stack
          // Folded, the list stays mounted, hidden (its scroll, open folders and drag state kept),
          // and the rail after it takes its place.
          display={railed ? 'none' : undefined}
          gap={0}
          w={240}
          miw={200}
          h="100%"
          bg="var(--mantine-color-default)"
          style={{ borderRight: '1px solid var(--mantine-color-default-border)', overflow: 'hidden' }}
        >
          <SidebarTop
            action={(
              // The row opens the template gallery; its ▾ holds the other ways to add a flow.
              <SidebarActionRow
                icon={Plus}
                label={t('flow.newFlow')}
                onClick={() => setTemplatesOpen(true)}
                trailing={(
                  <Menu position="bottom-end" offset={4} withinPortal zIndex={Z_POPOVER}>
                    <Menu.Target>
                      <ToolbarIconButton icon={ChevronDown} label={t('flow.newFlow.more')} onClick={() => undefined} />
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item leftSection={<Sparkles size={13} />} onClick={() => { setGenerateSeed(''); setGenerateOpen(true); }}>
                        {t('flow.generate')}
                      </Menu.Item>
                      <Menu.Item leftSection={<Download size={13} />} onClick={() => setImportOpen(true)}>
                        {t('flow.import')}
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                )}
              />
            )}
          >
            <ToolbarSearchButton label={t('flow.search.tooltip')} onClick={openSearch} />
            <ToolbarIconButton icon={PanelLeftClose} label={withCombo(t('sidebar.collapse'))} onClick={toggleSidebar} />
          </SidebarTop>

          <FlowSidebarList
            flows={flows}
            rows={rows}
            folders={folders}
            folderUi={folderUi}
            selectedFlowId={selectedFlowId}
            runningFlowIds={runningFlowIds}
            t={t}
            selectMode={selection.selectMode}
            isSelected={selection.isSelected}
            onToggleSelect={selection.toggle}
            onRowClick={handleRowClick}
            onContextMenu={(e, id) => openContextMenu(e, id)}
            onOpenMenuAt={openContextMenuAt}
            menuFlowId={contextMenu?.flowId ?? null}
            onToggleEnabled={(flow, enabled) => { void handleToggleEnabled(flow, enabled); }}
            onDelete={(flowId) => { setPendingDeleteId(flowId); setContextMenu(null); }}
            onReorder={(orderedIds) => { void reorderFlows(orderedIds); }}
          />

          {selection.selectMode && (
            <SelectionActionBar
              count={selection.count}
              allSelected={selection.allSelected(selectableIds)}
              onToggleAll={() => selection.toggleAll(selectableIds)}
              onDelete={() => setBulkDeleteOpen(true)}
              onCancel={selection.exit}
              t={t}
              extraActions={(
                <>
                  <MoveToFolderButton
                    files={selectedFolders}
                    folders={menuFolders}
                    label={ownName}
                    disabled={selection.count === 0}
                    onMove={(folder) => { void folderState.moveTo([...selection.selectedIds], folder); }}
                    onMoveToNew={() => { void folderState.createFolder([...selection.selectedIds]); }}
                    t={t}
                  />
                  <AppButton
                    size="xs"
                    variant="default"
                    px={6}
                    leftSection={<Power size={13} />}
                    disabled={selection.count === 0}
                    onClick={() => { void handleBulkSetEnabled(true); }}
                  >
                    {t('selection.enable')}
                  </AppButton>
                  <AppButton
                    size="xs"
                    variant="default"
                    px={6}
                    leftSection={<PowerOff size={13} />}
                    disabled={selection.count === 0}
                    onClick={() => { void handleBulkSetEnabled(false); }}
                  >
                    {t('selection.disable')}
                  </AppButton>
                </>
              )}
            />
          )}
          <SettingsFooter />
        </Stack>
        </SidebarDrawer>
        {railed && (
          <SidebarRail expandLabel={withCombo(t('sidebar.expand'))} onExpand={toggleSidebar} otherView="chat">
            <ToolbarIconButton icon={Plus} label={t('flow.newFlow')} onClick={() => setTemplatesOpen(true)} />
            <ToolbarSearchButton label={t('flow.search.tooltip')} onClick={openSearch} />
          </SidebarRail>
        )}

        <ContextMenuPortal
          position={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
          onClose={() => setContextMenu(null)}
        >
          <Menu.Item leftSection={<Play size={13} />} onClick={() => { void handleRunFlow(contextMenu!.flowId); }}>{t('flow.runFlow')}</Menu.Item>
          <Menu.Item leftSection={<Pencil size={13} />} rightSection={<ShortcutHint combo={renameCombo} />} onClick={() => { setRenameId(contextMenu!.flowId); setContextMenu(null); }}>{t('flow.renameFlow')}</Menu.Item>
          <Menu.Item leftSection={<Copy size={13} />} rightSection={<ShortcutHint combo={duplicateCombo} />} onClick={() => { void handleDuplicateFlow(contextMenu!.flowId); }}>{t('flow.duplicateFlow')}</Menu.Item>
          <Menu.Item leftSection={<Upload size={13} />} onClick={() => { void handleExportFlow(contextMenu!.flowId); }}>{t('flow.exportFlow')}</Menu.Item>
          {contextFlow && (
            <MoveToFolderSub
              files={[folderOf(contextFlow.id)]}
              folders={menuFolders}
              label={ownName}
              onMove={(folder) => { setContextMenu(null); void folderState.moveTo([contextFlow.id], folder); }}
              onMoveToNew={() => { setContextMenu(null); void folderState.createFolder([contextFlow.id]); }}
              t={t}
            />
          )}
          <Menu.Item leftSection={<ArrowUp size={13} />} disabled={!contextFlow || !neighbourOf(contextFlow.id, 'up')} onClick={() => { void handleMoveFlow(contextMenu!.flowId, 'up'); }}>{t('flow.flow.moveUp')}</Menu.Item>
          <Menu.Item leftSection={<ArrowDown size={13} />} disabled={!contextFlow || !neighbourOf(contextFlow.id, 'down')} onClick={() => { void handleMoveFlow(contextMenu!.flowId, 'down'); }}>{t('flow.flow.moveDown')}</Menu.Item>
          <Menu.Divider />
          <Menu.Item leftSection={<ListChecks size={13} />} disabled={flows.length < 2} onClick={() => handleStartSelection(contextMenu!.flowId)}>{t('selection.selectMultiple')}</Menu.Item>
          <Menu.Item leftSection={<Trash size={13} />} color="red" rightSection={<ShortcutHint combo={deleteCombo} />} onClick={() => { setPendingDeleteId(contextMenu!.flowId); setContextMenu(null); }}>{t('flow.deleteFlow')}</Menu.Item>
        </ContextMenuPortal>

        <FlowFolderMenu
          menu={folderState.folderMenu}
          anyOff={folderMenuFlows.some((flow) => !flow.enabled)}
          anyOn={folderMenuFlows.some((flow) => flow.enabled)}
          onClose={folderState.closeFolderMenu}
          onRename={folderState.startRename}
          onSetEnabled={(flowIds, enabled) => { void setFlowsEnabled(flowIds, enabled); }}
          onDelete={folderState.deleteFolder}
          t={t}
        />

        <FlowFolderSortModal
          open={sortOpen}
          flows={flows}
          unfiledCount={unfiledCount}
          onClose={() => setSortOpen(false)}
          t={t}
          locale={locale}
        />

        <WebDialog
          open={Boolean(pendingDeleteId)}
          title={t('flow.deleteFlow.confirm')}
          description={t('flow.deleteFlow.confirm.detail')}
          confirmText={t('common.delete')}
          cancelText={t('dialog.cancel')}
          danger
          onConfirm={() => { if (pendingDeleteId) void handleDeleteFlow(pendingDeleteId); }}
          onCancel={() => setPendingDeleteId(null)}
        />

        <WebDialog
          open={bulkDeleteOpen}
          title={fillTemplate(t('selection.deleteFlows.confirm'), { count: String(selection.count) })}
          description={t('selection.delete.detail')}
          confirmText={t('common.delete')}
          cancelText={t('dialog.cancel')}
          danger
          onConfirm={() => { void handleBulkDelete(); }}
          onCancel={() => setBulkDeleteOpen(false)}
        />

        {/* The gallery stays mounted underneath the wizard (Z_MODAL_NESTED), so backing out of
            setup lands back on it with the search and scroll position intact rather than on the
            flow list. It only closes once a flow has actually been created. */}
        <FlowTemplatesModal
          open={templatesOpen}
          t={t}
          onClose={() => setTemplatesOpen(false)}
          onPick={(tpl) => setWizardTemplate(tpl)}
          onBlank={() => {
            setTemplatesOpen(false);
            void createFlow();
          }}
          onGenerate={(seed) => {
            setTemplatesOpen(false);
            setGenerateSeed(seed);
            setGenerateOpen(true);
          }}
          escapeDisabled={wizardTemplate !== null}
        />

        <FlowSetupWizard
          template={wizardTemplate}
          t={t}
          onClose={() => setWizardTemplate(null)}
          onNavigateAway={() => { setWizardTemplate(null); setTemplatesOpen(false); }}
          onCreate={(flow) => {
            void importFlows([{ ...flow, enabled: true }]);
            setWizardTemplate(null);
            setTemplatesOpen(false);
          }}
        />

        <YtdlToolsDialog />

        <FlowImportModal
          open={importOpen}
          t={t}
          onClose={() => setImportOpen(false)}
          onImport={requestImport}
        />

        <FlowPreviewConfirm
          flows={pendingImport}
          t={t}
          onCancel={() => setPendingImport(null)}
          onConfirm={confirmImport}
        />

        <FlowGenerateModal
          open={generateOpen}
          t={t}
          onClose={() => setGenerateOpen(false)}
          onBuild={buildFlow}
          initialDescription={generateSeed}
        />

        <FlowRenameModal
          open={Boolean(renameFlow)}
          initialName={renameFlow?.name ?? ''}
          flow={renameFlow ?? null}
          t={t}
          onClose={() => setRenameId(null)}
          onRename={(name) => { if (renameId) void handleRenameFlow(renameId, name); }}
        />

        <FlowSearchOverlay opened={searchOpen} onClose={() => setSearchOpen(false)} />

        <Flex flex={1} direction="column" h="100%" style={{ overflow: 'hidden' }}>
          {selectedFlow ? (
            <FlowEditor
              flow={selectedFlow}
              t={t}
              onDelete={() => setPendingDeleteId(selectedFlow.id)}
              onDuplicate={() => { void handleDuplicateFlow(selectedFlow.id); }}
              onExport={() => { void handleExportFlow(selectedFlow.id); }}
              onMoveUp={() => { void handleMoveFlow(selectedFlow.id, 'up'); }}
              onMoveDown={() => { void handleMoveFlow(selectedFlow.id, 'down'); }}
              canMoveUp={Boolean(neighbourOf(selectedFlow.id, 'up'))}
              canMoveDown={Boolean(neighbourOf(selectedFlow.id, 'down'))}
            />
          ) : (
            <>
              {/* No editor, so no top row: the title bar over the pane is an empty strip to drag by
                  — in a narrow window with the way to the flows in the drawer. */}
              {narrowWindow ? <CaptionStrip><SidebarDrawerButton /></CaptionStrip> : <CaptionStrip />}
              <FlowHome
                flows={flows}
                folders={folders}
                t={t}
                locale={locale}
                {...(unfiledCount > 0 ? { onSmartSort: () => setSortOpen(true) } : {})}
                onOpenFlow={selectFlow}
                onBlank={() => { void createFlow(); }}
                onGenerate={(seed) => { setGenerateSeed(seed); setGenerateOpen(true); }}
                onImport={() => setImportOpen(true)}
                onPickTemplate={setWizardTemplate}
              />
            </>
          )}
        </Flex>
      </Flex>
    </FlowDropzone>
  );
};
