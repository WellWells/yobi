import React, { useMemo, useState } from 'react';
import { Badge, Box, Code, Flex, Group, Paper, Stack, Text } from '@mantine/core';
import { BookOpen, ChevronRight } from 'lucide-react';
import {
  closestCenter, DndContext, DragOverlay, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SectionCard } from '../../components/SectionCard';
import { StepCard, stepHasOutput } from './StepCard';
import { AddStepMenu } from './AddStepMenu';
import { DragHandle, useFlowSensors } from './dnd';
import { SKILL_ICON, skillHue } from './skills';
import type { LoopVarHint } from './variableInsert';
import { useAgentFlowStore } from '../../store/useAgentFlowStore';
import { findMatchingMarker } from '../../store/flowHelpers';
import type { FlowDefinition, SkillInstance, SkillType, TriggerConfig } from '../../../../shared/types';

const GUIDE = '2px dashed var(--mantine-color-violet-filled)';
const INDENT = 24;
const ENDERS: SkillType[] = ['end_loop', 'end_if'];

export interface FlowStepsCardProps {
  flow: FlowDefinition;
  t: (k: string) => string;
  onAddStep: (type: SkillType) => void;
}

interface RowProps {
  step: SkillInstance;
  index: number;
  total: number;
  level: number;
  prevLevel: number;
  prevStep?: SkillInstance;
  flowId: string;
  botTrigger: TriggerConfig;
  prevSteps: SkillInstance[];
  allPrevSteps: SkillInstance[];
  loopVars: LoopVarHint[];
  t: (k: string) => string;
}

// Memoized with per-index arrays precomputed in FlowStepsCard, so rows only
// re-render when flow.steps itself changes (not on name/description keystrokes).
const SortableStepRow: React.FC<RowProps> = React.memo(({
  step, index, total, level, prevLevel, prevStep, flowId, botTrigger, prevSteps, allPrevSteps, loopVars, t,
}) => {
  const locked = ENDERS.includes(step.type);
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,
  } = useSortable({ id: step.id });
  const indentPx = level * INDENT;

  const handle = locked
    ? <DragHandle label={t('agentflow.dragHandle')} locked />
    : <DragHandle ref={setActivatorNodeRef} label={t('agentflow.dragHandle')} {...attributes} {...listeners} />;

  return (
    <Box
      ref={setNodeRef}
      style={{
        position: 'relative',
        transform: isDragging || !transform ? undefined : `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        transition,
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 3 : undefined,
      }}
    >
      {Array.from({ length: level }).map((_, lIdx) => (
        <Box key={lIdx} style={{ position: 'absolute', left: `${(lIdx + 0.5) * INDENT}px`, top: 0, bottom: 0, width: 2, borderLeft: GUIDE, opacity: 0.6, zIndex: 1 }} />
      ))}

      {index > 0 && (
        <Flex direction="column" align="center" py={2} gap={2} style={{ position: 'relative' }}>
          {Array.from({ length: Math.min(level, prevLevel) }).map((_, lIdx) => (
            <Box key={lIdx} style={{ position: 'absolute', left: `${(lIdx + 0.5) * INDENT}px`, top: 0, bottom: 0, width: 2, borderLeft: GUIDE, opacity: 0.6, zIndex: 1 }} />
          ))}
          <Box style={{ paddingLeft: `${Math.max(level, prevLevel) * INDENT}px`, zIndex: 2 }}>
            <Flex direction="column" align="center" gap={2}>
              {prevStep && stepHasOutput(prevStep) && (
                <Code fz="xs" c="dimmed">{`{{${prevStep.outputKey}}}`}</Code>
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
          total={total}
          flowId={flowId}
          prevSteps={prevSteps}
          allPrevSteps={allPrevSteps}
          flowTrigger={botTrigger}
          loopVars={loopVars}
          dragHandle={handle}
          t={t}
        />
      </Box>
    </Box>
  );
});

const StepDragPreview: React.FC<{ step: SkillInstance; flow: FlowDefinition; t: (k: string) => string }> = ({ step, flow, t }) => {
  const hue = skillHue(step.type);
  const isBlock = step.type === 'loop' || step.type === 'if';
  let count = 0;
  if (isBlock) {
    const from = flow.steps.findIndex((s) => s.id === step.id);
    const match = findMatchingMarker(flow.steps, from);
    if (match >= 0) count = Math.abs(match - from) + 1;
  }
  return (
    <Paper withBorder p="xs" radius="md" shadow="md" style={{ borderLeft: `3px solid var(--mantine-color-${hue}-filled)`, cursor: 'grabbing' }}>
      <Group gap="xs" wrap="nowrap">
        <Badge variant="light" color={hue} size="sm" leftSection={SKILL_ICON[step.type]} radius="sm">
          {t(`agentflow.skill.${step.type}`)}
        </Badge>
        <Text fz="xs" c="dimmed" lineClamp={1}>
          {isBlock ? `(${count})` : (step.label || '')}
        </Text>
      </Group>
    </Paper>
  );
};

export const FlowStepsCard: React.FC<FlowStepsCardProps> = ({ flow, t, onAddStep }) => {
  const reorderSteps = useAgentFlowStore((s) => s.reorderSteps);
  const sensors = useFlowSensors();
  const [activeId, setActiveId] = useState<string | null>(null);

  const nestingLevels = useMemo(() => {
    let currentLevel = 0;
    const levels: number[] = [];
    for (let i = 0; i < flow.steps.length; i++) {
      const type = flow.steps[i].type;
      if (type === 'end_loop' || type === 'end_if') {
        levels.push(currentLevel);
        currentLevel = Math.max(0, currentLevel - 1);
      } else {
        levels.push(currentLevel);
        if (type === 'loop' || type === 'if') currentLevel++;
      }
    }
    return levels;
  }, [flow.steps]);

  const botTrigger = useMemo(
    () => [flow.trigger, ...(flow.extraTriggers ?? [])].find((tr) => tr.type === 'bot') ?? flow.trigger,
    [flow.trigger, flow.extraTriggers],
  );

  // Per-row arrays keyed on flow.steps keep row props referentially stable so
  // the memoized rows skip re-rendering when only flow metadata changes.
  const rowData = useMemo(() => {
    const loopStack: LoopVarHint[] = [];
    return flow.steps.map((step, index) => {
      const allPrevSteps = flow.steps.slice(0, index);
      const data = {
        allPrevSteps,
        prevSteps: allPrevSteps.filter(stepHasOutput),
        loopVars: [...loopStack],
      };
      if (step.type === 'loop') {
        const inputRef = /\{\{\s*([^}]+?)\s*\}\}/.exec(step.config.input ?? '')?.[1]?.trim().split('.')[0];
        const sourceType = inputRef ? allPrevSteps.find((s) => s.outputKey === inputRef)?.type : undefined;
        loopStack.push({ name: step.config.loopVar || 'item', sourceType });
      } else if (step.type === 'end_loop') {
        loopStack.pop();
      }
      return data;
    });
  }, [flow.steps]);

  const stepIds = useMemo(() => flow.steps.map((s) => s.id), [flow.steps]);
  const activeStep = activeId ? flow.steps.find((s) => s.id === activeId) ?? null : null;

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (over && active.id !== over.id) {
      reorderSteps(flow.id, String(active.id), String(over.id));
    }
  };

  return (
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
              <AddStepMenu position="top" t={t} onAdd={onAddStep} />
            </Stack>
          </Box>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveId(null)}
          >
            <SortableContext items={stepIds} strategy={verticalListSortingStrategy}>
              <Stack gap="sm">
                {flow.steps.map((step, index) => (
                  <SortableStepRow
                    key={step.id}
                    step={step}
                    index={index}
                    total={flow.steps.length}
                    level={nestingLevels[index] ?? 0}
                    prevLevel={index > 0 ? (nestingLevels[index - 1] ?? 0) : 0}
                    prevStep={index > 0 ? flow.steps[index - 1] : undefined}
                    flowId={flow.id}
                    botTrigger={botTrigger}
                    prevSteps={rowData[index].prevSteps}
                    allPrevSteps={rowData[index].allPrevSteps}
                    loopVars={rowData[index].loopVars}
                    t={t}
                  />
                ))}
                <AddStepMenu position="bottom" t={t} onAdd={onAddStep} />
              </Stack>
            </SortableContext>
            <DragOverlay modifiers={[restrictToVerticalAxis]}>
              {activeStep ? <StepDragPreview step={activeStep} flow={flow} t={t} /> : null}
            </DragOverlay>
          </DndContext>
        )}
      </Stack>
    </SectionCard>
  );
};
