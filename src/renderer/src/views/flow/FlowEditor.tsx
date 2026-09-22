import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon, Badge, Box, Button, Flex, Group, Loader, Menu, Stack, Text, Tooltip,
} from '@mantine/core';
import {
  ArrowDown, ArrowUp, Copy, Download, MoreVertical, Play, RotateCcw, Save, Square, Trash2,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useFlowStore } from '../../store/useFlowStore';
import { AppTextarea } from '../../components/AppTextarea';
import { AppTextInput } from '../../components/AppTextInput';
import { SectionCard } from '../../components/SectionCard';
import { ExecutionResultPanel } from './ExecutionResultPanel';
import { FlowStepsCard } from './FlowStepsCard';
import { FlowVariablesPanel } from './FlowVariablesPanel';
import { TriggerEditor } from './TriggerEditor';
import type { FlowDefinition, FlowVariable, SkillType } from '../../../../shared/types';
import { useShortcutAction } from '../../shortcuts/useShortcutAction';

export interface FlowEditorProps {
  flow: FlowDefinition;
  t: (k: string) => string;
  onDelete: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

export const FlowEditor: React.FC<FlowEditorProps> = ({
  flow, t, onDelete, onDuplicate, onExport, onMoveUp, onMoveDown, canMoveUp, canMoveDown,
}) => {
  const {
    updateFlow, saveFlow, executeFlow, abortFlow, addStep, isExecuting, runningFlowIds, restoreFlow, savedFlows,
  } = useFlowStore(
    useShallow((s) => ({
      updateFlow: s.updateFlow,
      saveFlow: s.saveFlow,
      executeFlow: s.executeFlow,
      abortFlow: s.abortFlow,
      addStep: s.addStep,
      isExecuting: s.isExecuting,
      runningFlowIds: s.runningFlowIds,
      restoreFlow: s.restoreFlow,
      savedFlows: s.savedFlows,
    })),
  );
  const hasExecutionLogs = useFlowStore((s) => s.executionLogs.length > 0);
  const isThisRunning = runningFlowIds.includes(flow.id);
  const prevHotkeyRef = useRef<string | undefined>(undefined);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [isPinned, setIsPinned] = useState(false);
  const savedFlow = savedFlows[flow.id];
  const savedFlowJson = useMemo(() => savedFlow ? JSON.stringify(savedFlow) : null, [savedFlow]);
  const isDirty = useMemo(() => {
    if (!savedFlowJson) return true;
    return JSON.stringify(flow) !== savedFlowJson;
  }, [flow, savedFlowJson]);

  useEffect(() => {
    const keys = flow.trigger.type === 'hotkey' ? (flow.trigger.keys ?? '') : '';
    if (flow.trigger.type === 'hotkey' && keys && keys !== prevHotkeyRef.current) {
      prevHotkeyRef.current = keys;
      void saveFlow(flow);
    }
  }, [flow, saveFlow]);

  // Back to the top when a different flow is opened. The editor stays mounted across the
  // switch, so without this you land wherever the previous flow was scrolled to — on a long
  // flow that means the new one's name, description and trigger card start off-screen, which
  // reads as "it opened the wrong thing". useLayoutEffect, or the old offset flashes for a frame.
  useLayoutEffect(() => {
    viewportRef.current?.scrollTo({ top: 0 });
  }, [flow.id]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const viewport = viewportRef.current;
    if (!sentinel || !viewport) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsPinned(!(entry?.isIntersecting ?? true)),
      { root: viewport, threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  const handleSave = useCallback(async () => { await saveFlow(flow); }, [flow, saveFlow]);
  const handleRestore = useCallback(() => { restoreFlow(flow.id); }, [flow.id, restoreFlow]);
  const handleRun = useCallback(async () => {
    await saveFlow(flow);
    await executeFlow(flow.id);
  }, [flow, saveFlow, executeFlow]);
  const handleStop = useCallback(() => { void abortFlow(flow.id); }, [abortFlow, flow.id]);

  useShortcutAction('flow.save', () => {
    if (isDirty) void handleSave();
  }, 'flow');

  const handleAddStep = useCallback((type: SkillType) => { addStep(flow.id, type); }, [addStep, flow.id]);
  const handleVariablesChange = useCallback((variables: FlowVariable[]) => {
    updateFlow({ ...flow, variables });
  }, [flow, updateFlow]);

  return (
    <Flex direction="column" h="100%" style={{ overflow: 'hidden' }}>
      <Box
        bg="var(--mantine-color-default)"
        style={{
          zIndex: 3,
          flexShrink: 0,
          transition: 'box-shadow 160ms ease, border-color 160ms ease',
          boxShadow: isPinned ? '0 8px 20px rgba(0, 0, 0, 0.18)' : 'none',
          borderBottom: isPinned ? '1px solid var(--mantine-color-default-border)' : '1px solid transparent',
        }}
      >
        <Box maw={560} mx="auto" px="20px" py="12px">
          <Group justify="flex-end" align="center" wrap="nowrap">
            {isDirty ? (
              <Badge color="orange" variant="light">{t('flow.unsaved')}</Badge>
            ) : (
              <Text fz="xs" c="dimmed">{t('flow.saved')}</Text>
            )}
            <Button
              variant="default"
              size="xs"
              leftSection={<RotateCcw size={14} />}
              onClick={handleRestore}
              disabled={!isDirty}
            >
              {t('flow.restore')}
            </Button>
            <Button variant="default" size="xs" leftSection={<Save size={14} />} onClick={handleSave} disabled={!isDirty}>
              {t('flow.saveFlow')}
            </Button>
            {isThisRunning ? (
              <Button
                variant="filled"
                color="red"
                size="xs"
                leftSection={<Square size={13} fill="currentColor" />}
                onClick={handleStop}
              >
                {t('flow.stopFlow')}
              </Button>
            ) : (
              <Button
                variant="filled"
                size="xs"
                leftSection={isExecuting ? <Loader size={14} color="white" /> : <Play size={14} />}
                onClick={handleRun}
                disabled={isExecuting}
              >
                {t('flow.runFlow')}
              </Button>
            )}
            <Menu position="bottom-end" withArrow shadow="md">
              <Menu.Target>
                <Tooltip label={t('common.moreActions')} position="bottom">
                  <ActionIcon variant="default" size="md" aria-label={t('common.moreActions')}>
                    <MoreVertical size={14} />
                  </ActionIcon>
                </Tooltip>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item leftSection={<Copy size={14} />} onClick={onDuplicate}>{t('flow.duplicateFlow')}</Menu.Item>
                <Menu.Item leftSection={<Download size={14} />} onClick={onExport}>{t('flow.exportFlow')}</Menu.Item>
                <Menu.Item leftSection={<ArrowUp size={14} />} disabled={!canMoveUp} onClick={onMoveUp}>{t('flow.flow.moveUp')}</Menu.Item>
                <Menu.Item leftSection={<ArrowDown size={14} />} disabled={!canMoveDown} onClick={onMoveDown}>{t('flow.flow.moveDown')}</Menu.Item>
                <Menu.Divider />
                <Menu.Item leftSection={<Trash2 size={14} />} color="red" onClick={onDelete}>{t('flow.deleteFlow')}</Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Box>
      </Box>
      <Box flex={1} h="100%" ref={viewportRef} style={{ overflowY: 'auto' }}>
        <Box ref={sentinelRef} h="1px" aria-hidden style={{ visibility: 'hidden', pointerEvents: 'none' }} />
        <Box p="24px 20px 40px">
          <Box maw={560} mx="auto">
            <Stack gap="xl">

              <SectionCard>
                <Stack gap="xs">
                  <AppTextInput
                    label={t('flow.flowName')}
                    placeholder={t('flow.flowName.placeholder')}
                    value={flow.name}
                    onChange={(e) => updateFlow({ ...flow, name: e.currentTarget.value })}
                    size="lg"
                  />
                  <AppTextarea
                    label={t('common.description')}
                    placeholder={t('flow.flowDescription.placeholder')}
                    value={flow.description}
                    onChange={(e) => updateFlow({ ...flow, description: e.currentTarget.value })}
                    minRows={2}
                    autosize
                    size="sm"
                  />
                </Stack>
              </SectionCard>

              <SectionCard>
                <Stack gap="sm">
                  <Text fw={600} fz="sm" c="var(--mantine-color-default-color)">{t('flow.trigger')}</Text>
                  <TriggerEditor flow={flow} t={t} />
                </Stack>
              </SectionCard>

              <FlowVariablesPanel flow={flow} t={t} onChange={handleVariablesChange} />

              <FlowStepsCard flow={flow} t={t} onAddStep={handleAddStep} />

              {hasExecutionLogs && (
                <ExecutionResultPanel
                  steps={flow.steps}
                  flowName={flow.name}
                  t={t}
                />
              )}
            </Stack>
          </Box>
        </Box>
      </Box>
    </Flex>
  );
};
