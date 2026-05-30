// AgentFlowView: flow editor and runner. Sidebar + editor panel layout.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon, Box, Flex, Group, Menu, Stack, Text, Tooltip,
} from '@mantine/core';
import {
  ArrowDown, ArrowUp, BookOpen, Copy, Download, Play, Plus, Trash2, Upload,
} from 'lucide-react';
import { useI18nStore } from '../../store/i18nStore';
import { useAgentFlowStore } from '../../store/useAgentFlowStore';
import { flowApi, ipcEvents } from '../../api/electronApi';
import { AgentFlowIcon } from '../../components/AgentFlowIcon';
import { PanelHeader } from '../../components/PanelHeader';
import { WebDialog } from '../../components/WebDialog';
import { ContextMenuPortal } from '../../components/ContextMenuPortal';
import type { FlowDefinition } from '../../../../shared/types';
import { FlowSidebarItem } from './FlowSidebarItem';
import { FlowEditor } from './FlowEditor';
import { FlowDropzone } from './FlowDropzone';
import { FlowTemplatesModal } from './FlowTemplatesModal';
import { FlowImportModal } from './FlowImportModal';

export const AgentFlowView: React.FC = () => {
  const { t } = useI18nStore();
  const {
    flows, selectedFlowId, runningFlowIds,
    loadFlows, selectFlow, createFlow, deleteFlow, duplicateFlow,
    saveFlow, updateFlow, moveFlow, executeFlow, importFlows,
    appendExecutionLog, markFlowRunning, markFlowDone,
  } = useAgentFlowStore();

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; flowId: string } | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => { void loadFlows(); }, [loadFlows]);

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

  const handleDeleteFlow = useCallback(async (flowId: string) => {
    await deleteFlow(flowId);
    setPendingDeleteId(null);
  }, [deleteFlow]);

  const handleDuplicateFlow = useCallback(async (flowId: string) => {
    await duplicateFlow(flowId);
    setContextMenu(null);
  }, [duplicateFlow]);

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
  const contextFlowIndex = contextFlow ? flows.findIndex((flow) => flow.id === contextFlow.id) : -1;

  return (
    <FlowDropzone t={t} onImport={(imported) => { void importFlows(imported); }}>
      <Flex flex={1} h="100%" style={{ overflow: 'hidden' }}>
        {/* Sidebar: flow list */}
        <Stack
          gap={0}
          w={240}
          miw={200}
          h="100%"
          bg="var(--mantine-color-default)"
          style={{ borderRight: '1px solid var(--mantine-color-default-border)', overflow: 'hidden' }}
        >
          <PanelHeader
            label={t('nav.agentflow')}
            icon={<AgentFlowIcon size={15} />}
            rightSection={(
              <Group gap={4}>
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
                    <Menu.Item leftSection={<BookOpen size={13} />} onClick={() => setTemplatesOpen(true)}>
                      {t('agentflow.templates')}
                    </Menu.Item>
                    <Menu.Item leftSection={<Download size={13} />} onClick={() => setImportOpen(true)}>
                      {t('agentflow.import')}
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </Group>
            )}
          />

          <Box flex={1} style={{ overflowY: 'auto', padding: '4px 0' }}>
            {flows.length === 0 ? (
              <Text p="20px 14px" c="dimmed" fz="sm" ta="center">{t('agentflow.flowList.empty')}</Text>
            ) : (
              flows.map((flow) => (
                <FlowSidebarItem
                  key={flow.id}
                  flow={flow}
                  selected={selectedFlowId === flow.id}
                  isRunning={runningFlowIds.includes(flow.id)}
                  t={t}
                  onSelect={() => selectFlow(flow.id)}
                  onContextMenu={(e) => openContextMenu(e, flow.id)}
                  onToggleEnabled={(enabled) => { void handleToggleEnabled(flow, enabled); }}
                />
              ))
            )}
          </Box>
        </Stack>

        {/* Context menu */}
        <ContextMenuPortal
          position={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
          onClose={() => setContextMenu(null)}
        >
          <Menu.Item leftSection={<Play size={13} />} onClick={() => { void handleRunFlow(contextMenu!.flowId); }}>{t('agentflow.runFlow')}</Menu.Item>
          <Menu.Item leftSection={<Copy size={13} />} onClick={() => { void handleDuplicateFlow(contextMenu!.flowId); }}>{t('agentflow.duplicateFlow')}</Menu.Item>
          <Menu.Item leftSection={<Upload size={13} />} onClick={() => { void handleExportFlow(contextMenu!.flowId); }}>{t('agentflow.exportFlow')}</Menu.Item>
          <Menu.Item leftSection={<ArrowUp size={13} />} disabled={contextFlowIndex <= 0} onClick={() => { void handleMoveFlow(contextMenu!.flowId, 'up'); }}>{t('agentflow.flow.moveUp')}</Menu.Item>
          <Menu.Item leftSection={<ArrowDown size={13} />} disabled={contextFlowIndex < 0 || contextFlowIndex >= flows.length - 1} onClick={() => { void handleMoveFlow(contextMenu!.flowId, 'down'); }}>{t('agentflow.flow.moveDown')}</Menu.Item>
          <Menu.Divider />
          <Menu.Item leftSection={<Trash2 size={13} />} color="red" onClick={() => { setPendingDeleteId(contextMenu!.flowId); setContextMenu(null); }}>{t('agentflow.deleteFlow')}</Menu.Item>
        </ContextMenuPortal>

        {/* Delete confirm dialog */}
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

        {/* Templates modal */}
        <FlowTemplatesModal
          open={templatesOpen}
          t={t}
          existingFlowNames={flows.map((f) => f.name)}
          onClose={() => setTemplatesOpen(false)}
          onImport={(imported) => { void importFlows(imported); setTemplatesOpen(false); }}
        />

        {/* Import modal (URL/file) */}
        <FlowImportModal
          open={importOpen}
          t={t}
          existingFlowNames={flows.map((f) => f.name)}
          onClose={() => setImportOpen(false)}
          onImport={(imported) => { void importFlows(imported); setImportOpen(false); }}
        />

        {/* Editor canvas */}
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
