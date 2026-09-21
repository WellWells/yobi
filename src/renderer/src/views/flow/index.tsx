import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Flex, Group, Menu, Stack,
} from '@mantine/core';
import {
  ArrowDown, ArrowUp, Copy, Download, LayoutTemplate, ListChecks, Pencil, Play, Plus, Power, PowerOff, Search, Sparkles, Trash2, Upload, Workflow,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useI18nStore } from '../../store/i18nStore';
import { useFlowStore } from '../../store/useFlowStore';
import { flowApi, ipcEvents } from '../../api/electronApi';
import { PanelToolbar, ToolbarButton, ToolbarIconButton } from '../../components/PanelToolbar';
import { EmptyState } from '../../components/EmptyState';
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
import { Z_POPOVER } from '../../config/zLayers';
import { useShortcutAction } from '../../shortcuts/useShortcutAction';
import { useResolvedCombo } from '../../store/shortcutStore';

export const FlowView: React.FC = () => {
  const { t } = useI18nStore();
  const {
    flows, selectedFlowId, runningFlowIds,
    selectFlow, createFlow, deleteFlow, deleteFlows, setFlowsEnabled, duplicateFlow,
    saveFlow, updateFlow, moveFlow, reorderFlows, executeFlow, importFlows, buildFlow,
    adoptFlow, appendExecutionLog, markFlowRunning, markFlowDone,
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
      moveFlow: s.moveFlow,
      reorderFlows: s.reorderFlows,
      executeFlow: s.executeFlow,
      importFlows: s.importFlows,
      buildFlow: s.buildFlow,
      adoptFlow: s.adoptFlow,
      appendExecutionLog: s.appendExecutionLog,
      markFlowRunning: s.markFlowRunning,
      markFlowDone: s.markFlowDone,
    })),
  );

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; flowId: string } | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [wizardTemplate, setWizardTemplate] = useState<FlowTemplate | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
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

  const renameCombo = useResolvedCombo('flow.rename');
  const duplicateCombo = useResolvedCombo('flow.duplicate');
  const deleteCombo = useResolvedCombo('flow.delete');

  useShortcutAction('nav.quickSwitch', () => {
    if (selection.selectMode) return;
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

  const openSearch = useCallback((): void => setSearchOpen(true), []);

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

  const handleMoveFlow = useCallback(async (flowId: string, direction: 'up' | 'down') => {
    await moveFlow(flowId, direction);
    setContextMenu(null);
  }, [moveFlow]);

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

  const handleRunAllFlows = useCallback(async () => {
    if (flows.length === 0 || isBatchRunning) return;
    const flowsToRun = [...flows];
    setIsBatchRunning(true);
    try {
      for (const flow of flowsToRun) {
        await saveFlow(flow);
      }
      await Promise.allSettled(flowsToRun.map((flow) => flowApi.execute(flow.id)));
    } finally {
      setIsBatchRunning(false);
      setContextMenu(null);
    }
  }, [flows, isBatchRunning, saveFlow]);

  const handleToggleEnabled = useCallback(async (flow: FlowDefinition, enabled: boolean) => {
    const updated = { ...flow, enabled };
    updateFlow(updated);
    await saveFlow(updated);
  }, [updateFlow, saveFlow]);

  const selectableIds = useMemo(() => flows.map((f) => f.id), [flows]);

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

  const contextFlow = useMemo(
    () => (contextMenu ? flows.find((flow) => flow.id === contextMenu.flowId) ?? null : null),
    [contextMenu, flows],
  );
  const renameFlow = useMemo(
    () => (renameId ? flows.find((flow) => flow.id === renameId) ?? null : null),
    [renameId, flows],
  );
  const contextFlowIndex = contextFlow ? flows.findIndex((flow) => flow.id === contextFlow.id) : -1;

  return (
    <FlowDropzone t={t} onImport={requestImport}>
      <Flex flex={1} h="100%" style={{ overflow: 'hidden' }}>
        <Stack
          gap={0}
          w={240}
          miw={200}
          h="100%"
          bg="var(--mantine-color-default)"
          style={{ borderRight: '1px solid var(--mantine-color-default-border)', overflow: 'hidden' }}
        >
          <PanelToolbar>
            <Menu trigger="hover" position="bottom-start" width="target" withinPortal zIndex={Z_POPOVER}>
              <Menu.Target>
                <ToolbarButton
                  icon={Plus}
                  label={t('flow.newFlow')}
                  withChevron
                  onClick={() => { void createFlow(); }}
                />
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item leftSection={<Plus size={13} />} onClick={() => { void createFlow(); }}>
                  {t('flow.newFlow')}
                </Menu.Item>
                <Menu.Item leftSection={<Sparkles size={13} />} onClick={() => setGenerateOpen(true)}>
                  {t('flow.generate')}
                </Menu.Item>
                <Menu.Item leftSection={<LayoutTemplate size={13} />} onClick={() => setTemplatesOpen(true)}>
                  {t('flow.templates')}
                </Menu.Item>
                <Menu.Item leftSection={<Upload size={13} />} onClick={() => setImportOpen(true)}>
                  {t('flow.import')}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
            <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
              <ToolbarIconButton icon={Search} label={t('flow.search.tooltip')} onClick={openSearch} />
              <ToolbarIconButton
                icon={Play}
                label={t('flow.runAll')}
                disabled={flows.length === 0 || isBatchRunning}
                onClick={() => { void handleRunAllFlows(); }}
              />
            </Group>
          </PanelToolbar>

          <FlowSidebarList
            flows={flows}
            selectedFlowId={selectedFlowId}
            runningFlowIds={runningFlowIds}
            t={t}
            selectMode={selection.selectMode}
            isSelected={selection.isSelected}
            onToggleSelect={selection.toggle}
            onRowClick={handleRowClick}
            onContextMenu={(e, id) => openContextMenu(e, id)}
            onToggleEnabled={(flow, enabled) => { void handleToggleEnabled(flow, enabled); }}
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
        </Stack>

        <ContextMenuPortal
          position={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
          onClose={() => setContextMenu(null)}
        >
          <Menu.Item leftSection={<Play size={13} />} onClick={() => { void handleRunFlow(contextMenu!.flowId); }}>{t('flow.runFlow')}</Menu.Item>
          <Menu.Item leftSection={<Pencil size={13} />} rightSection={<ShortcutHint combo={renameCombo} />} onClick={() => { setRenameId(contextMenu!.flowId); setContextMenu(null); }}>{t('flow.renameFlow')}</Menu.Item>
          <Menu.Item leftSection={<Copy size={13} />} rightSection={<ShortcutHint combo={duplicateCombo} />} onClick={() => { void handleDuplicateFlow(contextMenu!.flowId); }}>{t('flow.duplicateFlow')}</Menu.Item>
          <Menu.Item leftSection={<Download size={13} />} onClick={() => { void handleExportFlow(contextMenu!.flowId); }}>{t('flow.exportFlow')}</Menu.Item>
          <Menu.Item leftSection={<ArrowUp size={13} />} disabled={contextFlowIndex <= 0} onClick={() => { void handleMoveFlow(contextMenu!.flowId, 'up'); }}>{t('flow.flow.moveUp')}</Menu.Item>
          <Menu.Item leftSection={<ArrowDown size={13} />} disabled={contextFlowIndex < 0 || contextFlowIndex >= flows.length - 1} onClick={() => { void handleMoveFlow(contextMenu!.flowId, 'down'); }}>{t('flow.flow.moveDown')}</Menu.Item>
          <Menu.Divider />
          <Menu.Item leftSection={<ListChecks size={13} />} disabled={flows.length < 2} onClick={() => handleStartSelection(contextMenu!.flowId)}>{t('selection.selectMultiple')}</Menu.Item>
          <Menu.Item leftSection={<Trash2 size={13} />} color="red" rightSection={<ShortcutHint combo={deleteCombo} />} onClick={() => { setPendingDeleteId(contextMenu!.flowId); setContextMenu(null); }}>{t('flow.deleteFlow')}</Menu.Item>
        </ContextMenuPortal>

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
          title={t('selection.deleteFlows.confirm').replace('{{count}}', String(selection.count))}
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
        />

        <FlowRenameModal
          open={Boolean(renameFlow)}
          initialName={renameFlow?.name ?? ''}
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
              canMoveUp={flows.findIndex((flow) => flow.id === selectedFlow.id) > 0}
              canMoveDown={flows.findIndex((flow) => flow.id === selectedFlow.id) < flows.length - 1}
            />
          ) : (
            <EmptyState icon={Workflow} label={t('flow.emptyState')} fill />
          )}
        </Flex>
      </Flex>
    </FlowDropzone>
  );
};
