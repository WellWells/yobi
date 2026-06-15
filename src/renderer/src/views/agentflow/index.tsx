import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon, Box, Flex, Group, Menu, Stack, Text, Tooltip,
} from '@mantine/core';
import {
  ArrowDown, ArrowUp, BookOpen, Copy, Download, Pencil, Play, Plus, Search, Sparkles, Trash2, Upload, X,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useI18nStore } from '../../store/i18nStore';
import { useAgentFlowStore } from '../../store/useAgentFlowStore';
import { flowApi, ipcEvents } from '../../api/electronApi';
import { PanelToolbar } from '../../components/PanelToolbar';
import { AppTextInput } from '../../components/AppTextInput';
import { WebDialog } from '../../components/WebDialog';
import { ContextMenuPortal } from '../../components/ContextMenuPortal';
import type { FlowDefinition } from '../../../../shared/types';
import { FlowSidebarList } from './FlowSidebarList';
import { FlowEditor } from './FlowEditor';
import { FlowDropzone } from './FlowDropzone';
import { FlowTemplatesModal } from './FlowTemplatesModal';
import { FlowImportModal } from './FlowImportModal';
import { FlowGenerateModal } from './FlowGenerateModal';
import { FlowRenameModal } from './FlowRenameModal';

export const AgentFlowView: React.FC = () => {
  const { t } = useI18nStore();
  const {
    flows, selectedFlowId, runningFlowIds,
    selectFlow, createFlow, deleteFlow, duplicateFlow,
    saveFlow, updateFlow, moveFlow, reorderFlows, executeFlow, importFlows, generateFlow,
    appendExecutionLog, markFlowRunning, markFlowDone,
  } = useAgentFlowStore(
    useShallow((s) => ({
      flows: s.flows,
      selectedFlowId: s.selectedFlowId,
      runningFlowIds: s.runningFlowIds,
      selectFlow: s.selectFlow,
      createFlow: s.createFlow,
      deleteFlow: s.deleteFlow,
      duplicateFlow: s.duplicateFlow,
      saveFlow: s.saveFlow,
      updateFlow: s.updateFlow,
      moveFlow: s.moveFlow,
      reorderFlows: s.reorderFlows,
      executeFlow: s.executeFlow,
      importFlows: s.importFlows,
      generateFlow: s.generateFlow,
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
  const [importOpen, setImportOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const unsub = ipcEvents.onFlowExecutionLog((log) => { appendExecutionLog(log); });
    return unsub;
  }, [appendExecutionLog]);

  useEffect(() => {
    const unsubStart = ipcEvents.onFlowExecutionStarted((evt) => markFlowRunning(evt.flowId));
    const unsubEnd = ipcEvents.onFlowExecutionEnded((evt) => markFlowDone(evt.flowId));
    return () => { unsubStart(); unsubEnd(); };
  }, [markFlowRunning, markFlowDone]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete') return;
      if (!selectedFlowId || pendingDeleteId) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;
      setPendingDeleteId(selectedFlowId);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pendingDeleteId, selectedFlowId]);

  const selectedFlow = useMemo(
    () => flows.find((f) => f.id === selectedFlowId) ?? null,
    [flows, selectedFlowId],
  );

  const flowQuery = searchQuery.trim().toLowerCase();
  const isSearching = flowQuery.length > 0;
  const visibleFlows = useMemo(() => {
    if (!isSearching) return flows;
    return flows.filter((flow) =>
      flow.name.toLowerCase().includes(flowQuery)
      || (flow.description ?? '').toLowerCase().includes(flowQuery)
      || [flow.trigger, ...(flow.extraTriggers ?? [])].some((tr) => (tr?.type ?? '').toLowerCase().includes(flowQuery))
      || flow.steps.some((step) => (step.type ?? '').toLowerCase().includes(flowQuery) || (step.label ?? '').toLowerCase().includes(flowQuery)));
  }, [flows, flowQuery, isSearching]);

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
    <FlowDropzone t={t} onImport={(imported) => { void importFlows(imported); }}>
      <Flex flex={1} h="100%" style={{ overflow: 'hidden' }}>
        <Stack
          gap={0}
          w={240}
          miw={200}
          h="100%"
          bg="var(--mantine-color-default)"
          style={{ borderRight: '1px solid var(--mantine-color-default-border)', overflow: 'hidden' }}
        >
          <PanelToolbar gap={6}>
            {flows.length > 0 ? (
              <AppTextInput
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('agentflow.search.placeholder')}
                tone="tertiary"
                variant="default"
                size="xs"
                radius="sm"
                style={{ flex: 1, minWidth: 0 }}
                leftSection={<Search size={13} />}
                rightSection={searchQuery ? (
                  <ActionIcon variant="subtle" size={20} onClick={() => setSearchQuery('')} aria-label={t('agentflow.search.clear')}>
                    <X size={12} />
                  </ActionIcon>
                ) : undefined}
              />
            ) : (
              <Box style={{ flex: 1, minWidth: 0 }} />
            )}
            <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
              <Tooltip label={t('agentflow.runAll')}>
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  disabled={flows.length === 0 || isBatchRunning}
                  onClick={() => { void handleRunAllFlows(); }}
                >
                  <Play size={14} />
                </ActionIcon>
              </Tooltip>
              <Menu trigger="hover" position="bottom-end" withinPortal zIndex={200}>
                <Menu.Target>
                  <ActionIcon variant="subtle" size="sm" aria-label={t('agentflow.newFlow')}>
                    <Plus size={14} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item leftSection={<Plus size={13} />} onClick={() => { void createFlow(); }}>
                    {t('agentflow.newFlow')}
                  </Menu.Item>
                  <Menu.Item leftSection={<Sparkles size={13} />} onClick={() => setGenerateOpen(true)}>
                    {t('agentflow.generate')}
                  </Menu.Item>
                  <Menu.Item leftSection={<BookOpen size={13} />} onClick={() => setTemplatesOpen(true)}>
                    {t('agentflow.templates')}
                  </Menu.Item>
                  <Menu.Item leftSection={<Download size={13} />} onClick={() => setImportOpen(true)}>
                    {t('agentflow.import')}
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </Group>
          </PanelToolbar>

          <FlowSidebarList
            flows={flows}
            visibleFlows={visibleFlows}
            isSearching={isSearching}
            selectedFlowId={selectedFlowId}
            runningFlowIds={runningFlowIds}
            t={t}
            onSelect={(id) => selectFlow(id)}
            onContextMenu={(e, id) => openContextMenu(e, id)}
            onToggleEnabled={(flow, enabled) => { void handleToggleEnabled(flow, enabled); }}
            onReorder={(orderedIds) => { void reorderFlows(orderedIds); }}
          />
        </Stack>

        <ContextMenuPortal
          position={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
          onClose={() => setContextMenu(null)}
        >
          <Menu.Item leftSection={<Play size={13} />} onClick={() => { void handleRunFlow(contextMenu!.flowId); }}>{t('agentflow.runFlow')}</Menu.Item>
          <Menu.Item leftSection={<Pencil size={13} />} onClick={() => { setRenameId(contextMenu!.flowId); setContextMenu(null); }}>{t('agentflow.renameFlow')}</Menu.Item>
          <Menu.Item leftSection={<Copy size={13} />} onClick={() => { void handleDuplicateFlow(contextMenu!.flowId); }}>{t('agentflow.duplicateFlow')}</Menu.Item>
          <Menu.Item leftSection={<Upload size={13} />} onClick={() => { void handleExportFlow(contextMenu!.flowId); }}>{t('agentflow.exportFlow')}</Menu.Item>
          <Menu.Item leftSection={<ArrowUp size={13} />} disabled={contextFlowIndex <= 0} onClick={() => { void handleMoveFlow(contextMenu!.flowId, 'up'); }}>{t('agentflow.flow.moveUp')}</Menu.Item>
          <Menu.Item leftSection={<ArrowDown size={13} />} disabled={contextFlowIndex < 0 || contextFlowIndex >= flows.length - 1} onClick={() => { void handleMoveFlow(contextMenu!.flowId, 'down'); }}>{t('agentflow.flow.moveDown')}</Menu.Item>
          <Menu.Divider />
          <Menu.Item leftSection={<Trash2 size={13} />} color="red" onClick={() => { setPendingDeleteId(contextMenu!.flowId); setContextMenu(null); }}>{t('agentflow.deleteFlow')}</Menu.Item>
        </ContextMenuPortal>

        <WebDialog
          open={Boolean(pendingDeleteId)}
          title={t('agentflow.deleteFlow.confirm')}
          description={t('agentflow.deleteFlow.confirm.detail')}
          confirmText={t('common.delete')}
          cancelText={t('dialog.cancel')}
          danger
          onConfirm={() => { if (pendingDeleteId) void handleDeleteFlow(pendingDeleteId); }}
          onCancel={() => setPendingDeleteId(null)}
        />

        <FlowTemplatesModal
          open={templatesOpen}
          t={t}
          onClose={() => setTemplatesOpen(false)}
          onImport={(imported) => { void importFlows(imported); setTemplatesOpen(false); }}
        />

        <FlowImportModal
          open={importOpen}
          t={t}
          onClose={() => setImportOpen(false)}
          onImport={(imported) => { void importFlows(imported); setImportOpen(false); }}
        />

        <FlowGenerateModal
          open={generateOpen}
          t={t}
          onClose={() => setGenerateOpen(false)}
          onGenerate={generateFlow}
        />

        <FlowRenameModal
          open={Boolean(renameFlow)}
          initialName={renameFlow?.name ?? ''}
          t={t}
          onClose={() => setRenameId(null)}
          onRename={(name) => { if (renameId) void handleRenameFlow(renameId, name); }}
        />

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
            <Flex flex={1} align="center" justify="center">
              <Stack align="center" gap="xs">
                <BookOpen size={48} color="var(--mantine-color-dimmed)" />
                <Text c="dimmed" fz="sm">{t('agentflow.emptyState')}</Text>
              </Stack>
            </Flex>
          )}
        </Flex>
      </Flex>
    </FlowDropzone>
  );
};
