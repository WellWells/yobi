import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon, Badge, Box, Button, Code, Flex, Group, Loader, Menu, ScrollArea,
  SimpleGrid, Stack, Text,
} from '@mantine/core';
import {
  ArrowDown, ArrowUp, BookOpen, CheckCircle2, ChevronRight, Copy, History,
  MoreHorizontal, Play, Plus, RotateCcw, Save, Trash2, Upload, XCircle,
} from 'lucide-react';
import { useAgentFlowStore } from '../../store/useAgentFlowStore';
import { useAppStore } from '../../store/appStore';
import { AppTextarea } from '../../components/AppTextarea';
import { AppTextInput } from '../../components/AppTextInput';
import { SectionCard } from '../../components/SectionCard';
import { SKILL_ICON, STEP_CONFIG_EDITOR } from './skills';
import { StepCard, stepHasOutput } from './StepCard';
import { TriggerEditor } from './TriggerEditor';
import type { FlowDefinition, SkillType } from '../../../../shared/types';

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
  const { currentView } = useAppStore();
  const {
    updateFlow, saveFlow, executeFlow, addStep, isExecuting, executionLogs, restoreFlow, savedFlows,
  } = useAgentFlowStore();
  const prevHotkeyRef = useRef<string | undefined>(undefined);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [isPinned, setIsPinned] = useState(false);
  const savedFlow = savedFlows[flow.id];
  // Cache saved flow's serialized form — it only changes on save, so we avoid
  // re-serializing both objects on every keystroke edit.
  const savedFlowJson = useMemo(() => savedFlow ? JSON.stringify(savedFlow) : null, [savedFlow]);
  const isDirty = useMemo(() => {
    if (!savedFlowJson) return true;
    return JSON.stringify(flow) !== savedFlowJson;
  }, [flow, savedFlowJson]);

  const nestingLevels = useMemo(() => {
    let currentLevel = 0;
    const levels: number[] = [];
    for (let i = 0; i < flow.steps.length; i++) {
      const type = flow.steps[i].type;
      if (type === 'end_loop') {
        levels.push(currentLevel);
        currentLevel = Math.max(0, currentLevel - 1);
      } else {
        levels.push(currentLevel);
        if (type === 'loop') {
          currentLevel++;
        }
      }
    }
    return levels;
  }, [flow.steps]);

  useEffect(() => {
    const keys = flow.trigger.type === 'hotkey' ? (flow.trigger.keys ?? '') : '';
    if (flow.trigger.type === 'hotkey' && keys && keys !== prevHotkeyRef.current) {
      prevHotkeyRef.current = keys;
      void saveFlow(flow);
    }
  }, [flow, saveFlow]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const viewport = viewportRef.current;
    if (!sentinel || !viewport) return;
    // Use IntersectionObserver instead of a scroll event listener.
    // When the 1px sentinel exits the scroll viewport, the header is "pinned".
    const observer = new IntersectionObserver(
      ([entry]) => setIsPinned(!(entry?.isIntersecting ?? true)),
      { root: viewport, threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  const categorizedSkills = useMemo(() => [
    {
      category: t('agentflow.category.extraction'),
      items: ['scraper', 'browser', 'rss'] as SkillType[],
    },
    {
      category: t('agentflow.category.control'),
      items: ['loop', 'end_loop', 'stop'] as SkillType[],
    },
    {
      category: t('agentflow.category.actions'),
      items: ['llm', 'bot', 'clipboard'] as SkillType[],
    },
    {
      category: t('agentflow.category.tools'),
      items: ['shell', 'utility', 'comment'] as SkillType[],
    },
  ], [t]);

  const handleSave = useCallback(async () => { await saveFlow(flow); }, [flow, saveFlow]);
  const handleRestore = useCallback(() => { restoreFlow(flow.id); }, [flow.id, restoreFlow]);
  const handleRun = useCallback(async () => {
    await saveFlow(flow);
    await executeFlow(flow.id);
  }, [flow, saveFlow, executeFlow]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (currentView === 'agentflow' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (isDirty) {
          void handleSave();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [currentView, handleSave, isDirty]);

  const AddStepMenu: React.FC<{ position?: 'top' | 'bottom' }> = ({ position = 'bottom' }) => (
    <Menu position={position} withArrow shadow="md">
      <Menu.Target>
        <Button
          variant={position === 'top' ? 'light' : 'default'}
          size="sm"
          leftSection={<Plus size={14} />}
          fullWidth={position === 'bottom'}
          style={position === 'bottom' ? { borderStyle: 'dashed' } : undefined}
        >
          {t('agentflow.addStep')}
        </Button>
      </Menu.Target>
      <Menu.Dropdown p="xs" style={{ width: 440 }}>
        <SimpleGrid cols={2} spacing="xs" verticalSpacing="md">
          {categorizedSkills.map((cat) => (
            <Stack key={cat.category} gap={4}>
              <Text
                size="xs"
                fw={700}
                c="dimmed"
                px={8}
                py={4}
                style={{ letterSpacing: '0.5px', textTransform: 'uppercase' }}
              >
                {cat.category}
              </Text>
              {cat.items.map((type) => (
                <Menu.Item
                  key={type}
                  leftSection={SKILL_ICON[type]}
                  onClick={() => addStep(flow.id, type)}
                  style={{ height: 32 }}
                >
                  {t(`agentflow.skill.${type}`)}
                </Menu.Item>
              ))}
            </Stack>
          ))}
        </SimpleGrid>
      </Menu.Dropdown>
    </Menu>
  );

  return (
    <Flex direction="column" h="100%" style={{ overflow: 'hidden' }}>
      <ScrollArea flex={1} h="100%" viewportRef={viewportRef}>
        {/* 1px sentinel: when it exits the scroll viewport, the sticky header shows its shadow. */}
        <Box ref={sentinelRef} h="1px" aria-hidden style={{ visibility: 'hidden', pointerEvents: 'none' }} />
        <Box
          pos="sticky"
          top={0}
          bg="var(--mantine-color-default)"
          style={{
            zIndex: 3,
            transition: 'box-shadow 160ms ease, border-color 160ms ease',
            boxShadow: isPinned ? '0 8px 20px rgba(0, 0, 0, 0.18)' : 'none',
            borderBottom: isPinned ? '1px solid var(--mantine-color-default-border)' : '1px solid transparent',
          }}
        >
          <Box maw={560} mx="auto" px="20px" py="12px">
            <Group justify="flex-end" align="center" wrap="nowrap">
              {isDirty ? (
                <Badge color="orange" variant="light">{t('agentflow.unsaved')}</Badge>
              ) : (
                <Text fz="xs" c="dimmed">{t('agentflow.saved')}</Text>
              )}
              <Button
                variant="default"
                size="xs"
                leftSection={<RotateCcw size={14} />}
                onClick={handleRestore}
                disabled={!isDirty}
              >
                {t('agentflow.restore')}
              </Button>
              <Button variant="default" size="xs" leftSection={<Save size={14} />} onClick={handleSave} disabled={!isDirty}>
                {t('agentflow.saveFlow')}
              </Button>
              <Button
                variant="filled"
                size="xs"
                leftSection={isExecuting ? <Loader size={14} color="white" /> : <Play size={14} />}
                onClick={handleRun}
                disabled={isExecuting}
              >
                {t('agentflow.runFlow')}
              </Button>
              <Menu position="bottom-end" withArrow shadow="md">
                <Menu.Target>
                  <ActionIcon variant="default" size="md"><MoreHorizontal size={14} /></ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item leftSection={<Copy size={14} />} onClick={onDuplicate}>{t('agentflow.duplicateFlow')}</Menu.Item>
                  <Menu.Item leftSection={<Upload size={14} />} onClick={onExport}>{t('agentflow.exportFlow')}</Menu.Item>
                  <Menu.Item leftSection={<ArrowUp size={14} />} disabled={!canMoveUp} onClick={onMoveUp}>{t('agentflow.flow.moveUp')}</Menu.Item>
                  <Menu.Item leftSection={<ArrowDown size={14} />} disabled={!canMoveDown} onClick={onMoveDown}>{t('agentflow.flow.moveDown')}</Menu.Item>
                  <Menu.Divider />
                  <Menu.Item leftSection={<Trash2 size={14} />} color="red" onClick={onDelete}>{t('agentflow.deleteFlow')}</Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </Group>
          </Box>
        </Box>
        <Box p="24px 20px 40px">
          <Box maw={560} mx="auto">
            <Stack gap="xl">

            {/* Flow metadata */}
            <SectionCard>
              <Stack gap="xs">
                <AppTextInput
                  label={t('agentflow.flowName')}
                  placeholder={t('agentflow.flowName.placeholder')}
                  value={flow.name}
                  onChange={(e) => updateFlow({ ...flow, name: e.currentTarget.value })}
                  size="lg"
                />
                <AppTextarea
                  label={t('common.description')}
                  placeholder={t('agentflow.flowDescription.placeholder')}
                  value={flow.description}
                  onChange={(e) => updateFlow({ ...flow, description: e.currentTarget.value })}
                  minRows={2}
                  autosize
                  size="sm"
                />
              </Stack>
            </SectionCard>

            {/* Trigger config */}
            <SectionCard>
              <Stack gap="sm">
                <Text fw={600} fz="sm" c="var(--mantine-color-default-color)">{t('agentflow.trigger')}</Text>
                <TriggerEditor flow={flow} t={t} />
              </Stack>
            </SectionCard>

            {/* Steps */}
            <SectionCard>
              <Stack gap="sm">
                <Text fw={600} fz="sm" c="var(--mantine-color-default-color)">{t('agentflow.steps')}</Text>
                {flow.steps.length === 0 ? (
                  <Box
                    p="xl"
                    style={{
                      background: 'var(--mantine-color-bg-tertiary)',
                      borderRadius: 'var(--mantine-radius-md)',
                      border: '1px dashed var(--mantine-color-default-border)',
                      textAlign: 'center',
                    }}
                  >
                    <Stack align="center" gap="sm">
                      <BookOpen size={32} color="var(--mantine-color-dimmed)" />
                      <Text c="dimmed" fz="sm">{t('agentflow.steps.empty')}</Text>
                      <AddStepMenu position="top" />
                    </Stack>
                  </Box>
                ) : (
                  <Stack gap="sm">
                    {flow.steps.map((step, index) => {
                      const level = nestingLevels[index] ?? 0;
                      const prevLevel = index > 0 ? (nestingLevels[index - 1] ?? 0) : 0;
                      const indentPx = level * 24;
                      const loopVars: string[] = [];
                      {
                        const loopStack: string[] = [];
                        for (let k = 0; k < index; k++) {
                          if (flow.steps[k].type === 'loop') {
                            loopStack.push(flow.steps[k].config.loopVar || 'item');
                          } else if (flow.steps[k].type === 'end_loop') {
                            loopStack.pop();
                          }
                        }
                        loopVars.push(...loopStack);
                      }
                      return (
                        <Box key={step.id} style={{ position: 'relative' }}>
                          {/* Render guidelines for this step */}
                          {Array.from({ length: level }).map((_, lIdx) => (
                            <Box
                              key={lIdx}
                              style={{
                                position: 'absolute',
                                left: `${(lIdx + 0.5) * 24}px`,
                                top: 0,
                                bottom: 0,
                                width: '2px',
                                borderLeft: '2px dashed var(--mantine-color-teal-filled)',
                                opacity: 0.6,
                                zIndex: 1,
                              }}
                            />
                          ))}

                          {index > 0 && (
                            <Flex direction="column" align="center" py={2} gap={2} style={{ position: 'relative' }}>
                              {/* Separator nesting guidelines */}
                              {Array.from({ length: Math.min(level, prevLevel) }).map((_, lIdx) => (
                                <Box
                                  key={lIdx}
                                  style={{
                                    position: 'absolute',
                                    left: `${(lIdx + 0.5) * 24}px`,
                                    top: 0,
                                    bottom: 0,
                                    width: '2px',
                                    borderLeft: '2px dashed var(--mantine-color-teal-filled)',
                                    opacity: 0.6,
                                    zIndex: 1,
                                  }}
                                />
                              ))}
                              
                              <Box style={{ paddingLeft: `${Math.max(level, prevLevel) * 24}px`, zIndex: 2 }}>
                                <Flex direction="column" align="center" gap={2}>
                                  {stepHasOutput(flow.steps[index - 1]) && (
                                    <Code fz="xs" c="dimmed">{`{{${flow.steps[index - 1].outputKey}}}`}</Code>
                                  )}
                                  <ChevronRight size={14} color="var(--mantine-color-dimmed)" style={{ transform: 'rotate(90deg)' }} />
                                </Flex>
                              </Box>
                            </Flex>
                          )}

                          <Box style={{ paddingLeft: `${indentPx}px`, zIndex: 2, position: 'relative' }}>
                            <StepCard
                              step={step}
                              index={index}
                              total={flow.steps.length}
                              flowId={flow.id}
                              prevSteps={flow.steps.slice(0, index).filter(stepHasOutput)}
                              flowTrigger={flow.trigger}
                              loopVars={loopVars}
                              t={t}
                            />
                          </Box>
                        </Box>
                      );
                    })}
                    <AddStepMenu position="bottom" />
                  </Stack>
                )}
              </Stack>
            </SectionCard>

            {/* Execution result panel */}
            {executionLogs.length > 0 && (
              <SectionCard>
                <Stack gap="sm">
                  <Group gap="xs">
                    <History size={16} />
                    <Text fz="sm" fw={600}>{t('agentflow.execution.result')}</Text>
                  </Group>
                  <Stack gap="sm">
                    {flow.steps.map((step) => {
                      const log = [...executionLogs].reverse().find((l) => l.stepId === step.id);
                      if (!log) return null;
                      return (
                        <Box key={step.id}>
                          <Group gap="xs" wrap="nowrap">
                            {log.status === 'completed' && <CheckCircle2 size={14} color="var(--mantine-color-green-6)" />}
                            {log.status === 'error' && <XCircle size={14} color="var(--mantine-color-red-6)" />}
                            <Text fz="xs" fw={500}>{step.label}</Text>
                            {stepHasOutput(step) && <Code fz="xs">{`{{${step.outputKey}}}`}</Code>}
                          </Group>
                          {log.output && <Text fz="xs" c="dimmed" mt={2} lineClamp={5} ff="monospace">{log.output}</Text>}
                          {log.error && <Text fz="xs" c="red" mt={2}>{log.error}</Text>}
                        </Box>
                      );
                    })}
                  </Stack>
                </Stack>
              </SectionCard>
            )}
            </Stack>
          </Box>
        </Box>
      </ScrollArea>
    </Flex>
  );
};
