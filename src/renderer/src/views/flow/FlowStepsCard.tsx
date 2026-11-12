import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Box, Flex, Group, Paper, Stack, Text } from '@mantine/core';
import { ChevronRight, ListOrdered } from 'lucide-react';
import {
  closestCenter, DndContext, DragOverlay, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SectionCard } from '../../components/SectionCard';
import { EmptyState } from '../../components/EmptyState';
import { AppButton } from '../../components/AppButton';
import type { ProgressState } from '../../components/ProgressMark';
import { ATOMIC_STEPS, StepCard, stepHasOutput } from './StepCard';
import { AddStepMenu } from './AddStepMenu';
import { DragHandle, useFlowSensors } from './dnd';
import { SKILL_ICON, skillHue } from './skills';
import type { AvailableVarsInput } from './variableInsert';
import { flowBotTrigger, stepVarInput } from './stepVarInput';
import { validateOutputKey, type OutputKeyError } from './skills/validation';
import { stepMark } from './ExecutionResultPanel';
import { stepRunNote } from './stepRunNote';
import { stepLogsById } from './flowRunExport';
import { useStepExpansion } from './useStepExpansion';
import { useFlowStore } from '../../store/useFlowStore';
import { useFlowOutlineStore } from '../../store/useFlowOutlineStore';
import { setStepExpander } from './outline/locateStep';
import { collectStepIssues, withEndOfRunWarnings } from './outline/stepIssues';
import { noteScopeChange } from './moveNotice';
import { hiddenByFold, outlineRows } from './outline/outlineModel';
import { stepDisplayName } from './stepSummary';
import { useShallow } from 'zustand/react/shallow';
import { findMatchingMarker } from '../../store/flowHelpers';
import type { FlowDefinition, FlowVariable, SkillInstance, SkillType, TriggerConfig } from '../../../../shared/types';
import { nestingDepths } from '../../../../shared/flowBlockStructure';

const NO_VARIABLES: FlowVariable[] = [];
const GUIDE = '2px dashed var(--mantine-color-default-border)';
const INDENT = 24;
const ENDERS: SkillType[] = ['end_loop', 'end_if'];

export interface FlowStepsCardProps {
  flow: FlowDefinition;
  t: (k: string) => string;
  onAddStep: (type: SkillType) => void;
}

/*
 * Every prop of a row is a primitive or stays the same object while another step is edited: a
 * keystroke in one card draws that card alone (`flowEditorRenderCost`). What a card takes from the
 * steps before it is read through `varInput` when a menu opens, not handed down as arrays.
 */
interface RowProps {
  step: SkillInstance;
  index: number;
  total: number;
  level: number;
  prevLevel: number;
  flowId: string;
  botTrigger: TriggerConfig;
  outputKeyError: OutputKeyError;
  varInputFor: (stepId: string) => AvailableVarsInput;
  flowVariables: FlowVariable[];
  expanded: boolean;
  onToggle: (stepId: string) => void;
  runState?: ProgressState;
  runError?: string;
  runNote?: string;
  /** The block an end marker closes, the loop a break/continue leaves (`outlineRows`' owner). */
  ownerId?: string;
  selected: boolean;
  issue?: string;
  issueTone?: 'error' | 'warning';
  /** Inside a block folded in the editor: kept mounted (its form keeps its state), not drawn. */
  hidden: boolean;
  /** For a loop or condition: whether its steps are folded under it, and how many there are. */
  blockFolded?: boolean;
  blockSize?: number;
  onToggleBlock: (stepId: string) => void;
  /** The loops and conditions it is inside, by name, for the open card's header. */
  path?: string;
  t: (k: string) => string;
}

const SortableStepRow: React.FC<RowProps> = React.memo(({
  step, index, total, level, prevLevel, flowId, botTrigger, outputKeyError, varInputFor, flowVariables,
  expanded, onToggle, runState, runError, runNote, ownerId, selected, issue, issueTone, hidden, blockFolded, blockSize, onToggleBlock,
  path, t,
}) => {
  const stepId = step.id;
  const varInput = useCallback(() => varInputFor(stepId), [varInputFor, stepId]);
  const locked = ENDERS.includes(step.type);
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,
  } = useSortable({ id: step.id });
  const indentPx = level * INDENT;

  // The sortable hook draws this row again whenever the list's drag context does (every edit of
  // the flow); the handle stays the same element while its inputs do, so the card skips that pass.
  const handle = useMemo(() => (locked
    ? <DragHandle label={t('flow.dragHandle')} locked />
    : <DragHandle ref={setActivatorNodeRef} label={t('flow.dragHandle')} {...attributes} {...listeners} />
  ), [locked, t, setActivatorNodeRef, attributes, listeners]);

  return (
    <Box
      ref={setNodeRef}
      style={{
        position: 'relative',
        transform: isDragging || !transform ? undefined : `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        transition,
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 3 : undefined,
        display: hidden ? 'none' : undefined,
      }}
      data-block-hidden={hidden ? '' : undefined}
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
            <ChevronRight size={14} color="var(--mantine-color-dimmed)" style={{ transform: 'rotate(90deg)' }} />

          </Box>
        </Flex>
      )}

      <Box style={{ paddingLeft: `${indentPx}px`, zIndex: 2, position: 'relative' }}>
        <StepCard
          step={step}
          index={index}
          total={total}
          flowId={flowId}
          outputKeyError={outputKeyError}
          varInput={varInput}
          flowTrigger={botTrigger}
          flowVariables={flowVariables}
          dragHandle={handle}
          expanded={expanded}
          onToggle={onToggle}
          runState={runState}
          runError={runError}
          runNote={runNote}
          ownerId={ownerId}
          selected={selected}
          issue={issue}
          issueTone={issueTone}
          blockFolded={blockFolded}
          blockSize={blockSize}
          onToggleBlock={onToggleBlock}
          path={path}
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
    <Paper withBorder p="xs" radius="md" shadow="md" style={{ cursor: 'grabbing' }}>
      <Group gap="xs" wrap="nowrap">
        <Badge variant="light" color={hue} size="sm" leftSection={SKILL_ICON[step.type]}>
          {t(`flow.skill.${step.type}`)}
        </Badge>
        <Text fz="xs" c="dimmed" lineClamp={1}>
          {isBlock ? `(${count})` : (step.label || '')}
        </Text>
      </Group>
    </Paper>
  );
};

export const FlowStepsCard: React.FC<FlowStepsCardProps> = ({ flow, t, onAddStep }) => {
  const reorderSteps = useFlowStore((s) => s.reorderSteps);
  const sensors = useFlowSensors();
  const [activeId, setActiveId] = useState<string | null>(null);

  const nestingLevels = useMemo(() => nestingDepths(flow.steps, 'body'), [flow.steps]);

  const botTrigger = useMemo(() => flowBotTrigger(flow), [flow.trigger, flow.extraTriggers]);

  const flowVariables = useMemo(() => flow.variables ?? NO_VARIABLES, [flow.variables]);

  // Read at call time: a menu that opens sees the flow as it is then.
  const flowRef = useRef(flow);
  flowRef.current = flow;
  const varInputFor = useCallback((stepId: string): AvailableVarsInput => {
    const current = flowRef.current;
    return stepVarInput(current, current.steps.findIndex((s) => s.id === stepId));
  }, []);

  // Checked here, against the steps before each: a renamed output redraws only the cards whose
  // verdict changes.
  const outputKeyErrors = useMemo(() => {
    const before: string[] = [];
    return flow.steps.map((step): OutputKeyError => {
      if (!stepHasOutput(step)) return null;
      const error = validateOutputKey(step.outputKey, before);
      before.push(step.outputKey);
      return error;
    });
  }, [flow.steps]);

  // Joined, so the list (and dnd-kit's context under it) stays the same array while steps are edited.
  const stepIdsKey = flow.steps.map((s) => s.id).join('\n');
  const stepIds = useMemo(() => (stepIdsKey ? stepIdsKey.split('\n') : []), [stepIdsKey]);
  const activeStep = activeId ? flow.steps.find((s) => s.id === activeId) ?? null : null;

  // The last run of this flow, on the card of each step it reached.
  const executionLogs = useFlowStore((s) => s.executionLogs);
  const flowRunning = useFlowStore((s) => s.runningFlowIds.includes(flow.id));
  const runByStep = useMemo(
    () => stepLogsById(executionLogs.filter((log) => log.flowId === flow.id)),
    [executionLogs, flow.id],
  );
  const failedIds = useMemo(
    () => flow.steps.filter((s) => runByStep.get(s.id)?.error).map((s) => s.id),
    [flow.steps, runByStep],
  );
  const { expanded, toggle, setAll } = useStepExpansion(flow.id, stepIds, failedIds);
  const foldableIds = useMemo(
    () => flow.steps.filter((s) => !ATOMIC_STEPS.includes(s.type)).map((s) => s.id),
    [flow.steps],
  );
  const allOpen = foldableIds.length > 0 && foldableIds.every((id) => expanded.has(id));

  // A step behind while typing (the checks walk every reference): the keystroke's card draws first.
  const checkedFlow = useDeferredValue(flow);
  const stepIssues = useMemo(
    () => withEndOfRunWarnings(checkedFlow.steps, collectStepIssues(checkedFlow, t), t),
    [checkedFlow, t],
  );

  // The outline's pick: which card it landed on, and opening that card's form.
  const selectedId = useFlowOutlineStore((s) => s.selected[flow.id]);
  const { editorFolded, toggleEditorFold, unfoldEditor } = useFlowOutlineStore(useShallow((s) => ({
    editorFolded: s.editorFolded[flow.id],
    toggleEditorFold: s.toggleEditorFold,
    unfoldEditor: s.unfoldEditor,
  })));
  const rows = useMemo(() => outlineRows(flow.steps), [flow.steps]);
  useEffect(() => {
    setStepExpander((stepId, expand) => {
      // A jump into a folded block opens it first, or there is no card to land on. Read from the
      // store, not the last render: a step added or applied a moment ago is not drawn yet.
      const steps = useFlowStore.getState().flows.find((f) => f.id === flow.id)?.steps ?? [];
      const ancestors = outlineRows(steps).find((row) => row.step.id === stepId)?.ancestors ?? [];
      unfoldEditor(flow.id, ancestors);
      if (expand) setAll([stepId], true);
    });
    return () => setStepExpander(null);
  }, [setAll, unfoldEditor, flow.id]);
  const foldedBlocks = useMemo(() => new Set(editorFolded ?? []), [editorFolded]);
  const hiddenIds = useMemo(() => hiddenByFold(rows, foldedBlocks), [rows, foldedBlocks]);
  const onToggleBlock = useCallback((stepId: string) => toggleEditorFold(flow.id, stepId), [toggleEditorFold, flow.id]);
  // Joined to a string per row: a card redraws only when the names of its blocks change.
  const paths = useMemo(() => {
    const byId = new Map(flow.steps.map((step) => [step.id, step]));
    return rows.map((row) => row.ancestors
      .map((id) => byId.get(id))
      .filter((step): step is SkillInstance => Boolean(step))
      .map((step) => stepDisplayName(step, t))
      .join(' › '));
  }, [rows, flow.steps, t]);

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (over && active.id !== over.id) {
      const before = flow.steps;
      reorderSteps(flow.id, String(active.id), String(over.id));
      noteScopeChange(flow.id, String(active.id), before, t);
    }
  };

  return (
    <SectionCard>
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap">
          <Text fw={600} fz="sm" c="var(--mantine-color-default-color)">{t('flow.steps')}</Text>
          {foldableIds.length > 1 && (
            <AppButton variant="subtle" size="compact-xs" onClick={() => setAll(foldableIds, !allOpen)}>
              {t(allOpen ? 'flow.steps.collapseAll' : 'flow.steps.expandAll')}
            </AppButton>
          )}
        </Group>
        {flow.steps.length === 0 ? (
          <Box
            style={{
              background: 'var(--mantine-color-bg-tertiary)',
              borderRadius: 'var(--mantine-radius-md)',
              border: '1px dashed var(--mantine-color-default-border)',
            }}
          >
            <EmptyState icon={ListOrdered} label={t('flow.steps.empty')}>
              <AddStepMenu position="top" t={t} onAdd={onAddStep} />
            </EmptyState>
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
                {flow.steps.map((step, index) => {
                  const log = runByStep.get(step.id);
                  return (
                  <SortableStepRow
                    key={step.id}
                    step={step}
                    index={index}
                    total={flow.steps.length}
                    level={nestingLevels[index] ?? 0}
                    prevLevel={index > 0 ? (nestingLevels[index - 1] ?? 0) : 0}
                    flowId={flow.id}
                    botTrigger={botTrigger}
                    outputKeyError={outputKeyErrors[index] ?? null}
                    varInputFor={varInputFor}
                    flowVariables={flowVariables}
                    expanded={expanded.has(step.id)}
                    onToggle={toggle}
                    runState={log ? stepMark(log.status, flowRunning, log.error) : undefined}
                    runError={log?.error ? (log.displayError ?? log.error) : undefined}
                    runNote={stepRunNote(step, log, rows[index]?.childCount, t)}
                    ownerId={rows[index]?.owner}
                    selected={step.id === selectedId}
                    issue={stepIssues.get(step.id)?.text}
                    issueTone={stepIssues.get(step.id)?.tone}
                    hidden={hiddenIds.has(step.id)}
                    blockFolded={rows[index]?.childCount !== undefined ? foldedBlocks.has(step.id) : undefined}
                    blockSize={rows[index]?.childCount}
                    onToggleBlock={onToggleBlock}
                    path={paths[index] || undefined}
                    t={t}
                  />
                  );
                })}
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
