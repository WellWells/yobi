import React, { useCallback, useRef } from 'react';
import {
  ActionIcon, Badge, Box, Code, Group, Paper, Stack, Text, Tooltip, UnstyledButton,
} from '@mantine/core';
import { TriangleExclamationPoint, ArrowDown, ArrowUp, ChevronDown, ChevronsDownUp, ChevronsUpDown, Copy, Trash } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { AppTextInput } from '../../components/AppTextInput';
import { ProgressMark, type ProgressState } from '../../components/ProgressMark';
import { MOVE_BLOCKED_MESSAGE, useFlowStore } from '../../store/useFlowStore';
import { SKILL_ICON, STEP_CONFIG_EDITOR, skillHue, isDangerSkill } from './skills';
import { InsertDataMenu, InsertDataSubmenu, insertTokenAtCaret, type AvailableVarsInput } from './variableInsert';
import { useTextMenuExtra } from '../../components/textContextMenu/textMenuExtras';
import type { OutputKeyError } from './skills/validation';
import { stepHeadline } from './stepHeadline';
import { useNamedModels } from './useNamedModels';
import { INSERT_DATA_IN_FORM, NO_INSERT_DATA } from './skills/types';
import { StepDraftButton, type StepDraftButtonRender } from './StepDraftButton';
import { deleteStepWithUndo } from './deleteStep';
import { InsertStepBelow } from './InsertStepBelow';
import { noteScopeChange } from './moveNotice';
import { STEP_FORM_CONTAINER } from './editorColumn';
import { locateStep } from './outline/locateStep';
import { useFlowOutlineStore } from '../../store/useFlowOutlineStore';
import { fillTemplate } from '../../../../shared/fillTemplate';
import { showAppNotice } from '../../hooks/useUiNotifications';
import { stepHasOutput } from './stepOutput';
import { ATOMIC_STEPS, hasLabelField } from './stepLabelRules';
import { RenameInput } from '../../components/RenameInput';
import { stepNameSource } from './assist/flowAssistActions';
import type { FlowVariable, SkillInstance, SkillType, TriggerConfig } from '../../../../shared/types';

export { stepHasOutput };
export { ATOMIC_STEPS };

/** Copying a loop or condition copies its whole block, so its end has nothing to copy alone. */
const END_MARKERS: SkillType[] = ['end_loop', 'end_if'];

/** The card's element id, for scrolling to a step from elsewhere in the editor. */
export function stepDomId(stepId: string): string {
  return `flow-step-${stepId}`;
}

export interface StepCardProps {
  step: SkillInstance;
  index: number;
  total: number;
  flowId: string;
  /** Why the output name cannot be used (empty, malformed, taken by an earlier step), if it cannot. */
  outputKeyError: OutputKeyError;
  /** What this step can take from the flow, read when a menu that lists it opens. */
  varInput: () => AvailableVarsInput;
  flowTrigger?: TriggerConfig;
  flowVariables?: FlowVariable[];
  dragHandle?: React.ReactNode;
  /** Drawn open: its form is shown. A step with an error in its form is open regardless. */
  expanded: boolean;
  onToggle: (stepId: string) => void;
  /** Where the last run of this flow got with this step; absent when it never reached it. */
  runState?: ProgressState;
  /** What the flow's checks find wrong with it (a reference to nothing, an unpaired end), if anything. */
  issue?: string;
  issueTone?: 'error' | 'warning';
  /** For a loop or condition: its steps are folded under it in the editor; how many it has. */
  blockFolded?: boolean;
  blockSize?: number;
  onToggleBlock?: (stepId: string) => void;
  /** The loops and conditions it is inside, by name ("逐篇處理 › 重要的才通知"). */
  path?: string;
  /** Picked in the outline: a 1px accent ring, so the card a jump landed on is findable. */
  selected?: boolean;
  /** Why the last run failed on this step, in the user's language. */
  runError?: string;
  /** What else the last run says about it: why it was skipped on purpose, whether a condition held. */
  runNote?: string;
  /**
   * For an end marker, the block it closes; for break/continue, the loop it leaves: its title
   * jumps there.
   */
  ownerId?: string;
  t: (k: string) => string;
}

/** The atomic control steps whose title is a way to the block they belong to. */
const OWNED_STEPS: SkillType[] = ['end_loop', 'end_if', 'break', 'continue'];

const NO_VARIABLES: FlowVariable[] = [];

/** A root that holds no field: registers the right-click extra for nothing. */
const NO_MENU_ROOT: React.RefObject<HTMLElement | null> = { current: null };

export const StepCard: React.FC<StepCardProps> = React.memo(({
  step, index, total, flowId, outputKeyError, varInput, flowTrigger,
  flowVariables = NO_VARIABLES, dragHandle, expanded, onToggle, runState, runError, runNote, selected, issue, issueTone,
  blockFolded, blockSize, onToggleBlock, path, ownerId, t,
}) => {
  const { updateStep, moveStep, duplicateStep } = useFlowStore(
    useShallow((s) => ({
      updateStep: s.updateStep,
      moveStep: s.moveStep,
      duplicateStep: s.duplicateStep,
    })),
  );
  const namedModels = useNamedModels();
  // Read when a model is picked on the name's ✨: the steps around this one, which the card does not redraw for.
  const nameSource = useCallback(() => stepNameSource(flowId, step.id, namedModels), [flowId, step.id, namedModels]);
  const ConfigEditor = STEP_CONFIG_EDITOR[step.type];
  const skillLabelKey = `flow.skill.${step.type}` as const;

  const lastFocusedRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const configRef = useRef<HTMLDivElement | null>(null);

  // Right-click in a step field: 「插入資料 ▸」 after Cut / Copy / Paste, same groups as the button.
  useTextMenuExtra(NO_INSERT_DATA.has(step.type) ? NO_MENU_ROOT : configRef, (insert) => (
    <InsertDataSubmenu varInput={varInput} insert={insert} t={t} />
  ));

  const handleConfigChange = useCallback((config: Record<string, string>) => {
    updateStep(flowId, step.id, { config });
  }, [flowId, step.id, updateStep]);

  const handleFocusCapture = useCallback((e: React.FocusEvent) => {
    const el = e.target as HTMLElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      lastFocusedRef.current = el;
    }
  }, []);

  const handleInsertVar = useCallback((token: string) => {
    const el = lastFocusedRef.current;
    if (el && el.isConnected) {
      insertTokenAtCaret(el, token);
    } else {
      void navigator.clipboard?.writeText(token);
    }
  }, []);

  // Deleting does not ask: the step can be taken back from the notice for a few seconds.
  const handleDelete = useCallback(() => {
    deleteStepWithUndo(flowId, step.id, t);
  }, [flowId, step.id, t]);

  // A move that would unpair an if/loop block, or take break/continue out of its loop, is refused.
  const handleMove = useCallback((direction: 'up' | 'down') => {
    const before = useFlowStore.getState().flows.find((flow) => flow.id === flowId)?.steps ?? [];
    const result = moveStep(flowId, step.id, direction);
    if (result.ok) {
      noteScopeChange(flowId, step.id, before, t);
      return;
    }
    if (result.reason === 'edge') return;
    showAppNotice({ level: 'warning', message: t(MOVE_BLOCKED_MESSAGE[result.reason]) });
  }, [flowId, step.id, moveStep, t]);

  if (!ConfigEditor) {
    return (
      <Paper withBorder p="sm" radius="md" bg="color-mix(in srgb, var(--mantine-color-error) 10%, transparent)">
        <Stack gap="xs">
          <Group justify="space-between" wrap="nowrap" align="flex-start">
            <Group gap="xs" wrap="nowrap" align="center">
              <Badge variant="light" color="var(--mantine-color-error)" size="sm" leftSection={<TriangleExclamationPoint size={14} />}>
                {t('flow.step.unknown')}
              </Badge>
              <Code fz="xs" c="var(--mantine-color-error)">{step.type}</Code>
              <Text fz="xs" c="dimmed">#{index + 1}</Text>
            </Group>
            <Tooltip label={t('flow.step.delete')} position="top">
              <ActionIcon variant="subtle" color="red" size="sm" onClick={handleDelete}>
                <Trash size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
          <Text fz="xs" c="dimmed">{t('flow.step.unknown.hint')}</Text>
        </Stack>
      </Paper>
    );
  }

  const hue = skillHue(step.type);
  const danger = isDangerSkill(step.type);
  const atomic = ATOMIC_STEPS.includes(step.type);
  const showLabel = hasLabelField(step.type);
  const open = !atomic && (expanded || outputKeyError !== null);
  const headline = stepHeadline(step, t, namedModels);
  const insertInForm = INSERT_DATA_IN_FORM.has(step.type);
  const draftButton: StepDraftButtonRender = (field, kind, fieldLabel) => (
    <StepDraftButton
      flowId={flowId}
      stepId={step.id}
      stepLabel={step.label.trim() || t(skillLabelKey)}
      field={field}
      kind={kind}
      fieldLabel={fieldLabel}
      value={step.config[field] ?? ''}
      varInput={varInput}
      t={t}
    />
  );
  const insertDataMenu = <InsertDataMenu varInput={varInput} onInsert={handleInsertVar} t={t} />;

  const title = (
    <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
      {open && path && (
        <Text fz={11} c="var(--text-muted)" lineClamp={1} data-step-path="" style={{ wordBreak: 'break-all' }}>{path}</Text>
      )}
      {headline.title ? (
        <Text fz="sm" fw={500} lineClamp={1} ff={headline.titleIsCode ? 'monospace' : undefined} style={{ wordBreak: 'break-all' }}>
          {headline.title}
        </Text>
      ) : (
        !atomic && <Text fz="sm" c="dimmed">{t('flow.step.notConfigured')}</Text>
      )}
      {!open && headline.detail && (
        <Text fz="xs" c="dimmed" lineClamp={1} ff={headline.detailIsCode ? 'monospace' : undefined} style={{ wordBreak: 'break-all' }}>
          {headline.detail}
        </Text>
      )}
      {blockFolded && blockSize ? (
        <Text fz="xs" c="var(--text-muted)" data-block-folded="">{fillTemplate(t('flow.step.block.foldedCount'), { count: String(blockSize) })}</Text>
      ) : null}
      {issue && !outputKeyError && (
        <Text
          fz="xs"
          c={issueTone === 'warning' ? 'var(--mantine-color-warning)' : 'var(--mantine-color-error)'}
          lineClamp={open ? undefined : 1}
          data-step-issue={issueTone ?? 'error'}
          style={{ display: 'flex', gap: 4, alignItems: 'flex-start', wordBreak: 'break-word' }}
        >
          <TriangleExclamationPoint size={12} style={{ flexShrink: 0, marginTop: 2 }} />
          {issue}
        </Text>
      )}
      {runNote && !runError && (
        <Text fz="xs" c="var(--text-muted)" lineClamp={1} data-step-run-note="">{runNote}</Text>
      )}
    </Stack>
  );

  const goToOwner = ownerId && OWNED_STEPS.includes(step.type)
    ? (): void => {
      useFlowOutlineStore.getState().select(flowId, ownerId);
      locateStep(ownerId, { focus: true });
    }
    : undefined;
  const ownerLabel = t(step.type === 'break' || step.type === 'continue' ? 'flow.step.goToLoop' : 'flow.outline.goToStart');

  return (
    <Paper
      withBorder
      p="sm"
      radius="md"
      id={stepDomId(step.id)}
      data-step-id={step.id}
      data-selected={selected ? 'true' : undefined}
      style={{ scrollMarginTop: 12, ...(selected ? { outline: '1px solid var(--mantine-primary-color-filled)', outlineOffset: 1 } : {}) }}
      data-expanded={open ? 'true' : 'false'}
      data-run={runState}
      bg={danger ? 'color-mix(in srgb, var(--mantine-color-red-light) 50%, transparent)' : undefined}
    >
      <Stack gap="xs">
        {/* An open card can be taller than the editor (a long prompt): its header stays at the top
            while the form scrolls under it, so its name and actions are never out of reach. */}
        <Group
          justify="space-between"
          wrap="nowrap"
          align="flex-start"
          gap="xs"
          data-step-header=""
          style={open ? { position: 'sticky', top: 0, zIndex: 3, background: 'var(--mantine-color-body)', paddingBlock: 4, marginBlock: -4 } : undefined}
        >
          <Group gap="xs" wrap="nowrap" align="flex-start" style={{ flex: 1, minWidth: 0 }}>
            {dragHandle}
            <Badge variant="light" color={hue} size="sm" leftSection={SKILL_ICON[step.type]} mt={1} style={{ flexShrink: 0 }}>
              {t(skillLabelKey)}
            </Badge>
            <Text fz="xs" c="dimmed" mt={2} style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>#{index + 1}</Text>
            {runState && (
              <Box mt={5} style={{ display: 'inline-flex', flexShrink: 0 }}>
                <ProgressMark state={runState} />
              </Box>
            )}
            {atomic && goToOwner && (
              <Tooltip label={ownerLabel} position="top">
                <UnstyledButton
                  data-step-title=""
                  data-step-owner-link=""
                  onClick={goToOwner}
                  style={{ flex: 1, minWidth: 0, display: 'flex' }}
                >
                  {title}
                </UnstyledButton>
              </Tooltip>
            )}
            {atomic && !goToOwner && title}
            {!atomic && (
              <UnstyledButton
                aria-expanded={open}
                data-step-title=""
                disabled={outputKeyError !== null}
                onClick={() => onToggle(step.id)}
                style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-start', gap: 4 }}
              >
                {title}
                <ChevronDown
                  size={14}
                  color="var(--mantine-color-dimmed)"
                  style={{ flexShrink: 0, marginTop: 3, transform: open ? 'rotate(180deg)' : undefined }}
                />
              </UnstyledButton>
            )}
          </Group>
          <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
            {open && stepHasOutput(step) && (
              <Code fz="xs" c="dimmed">{`{{${step.outputKey}}}`}</Code>
            )}
            {onToggleBlock && (blockSize ?? 0) > 0 && (
              <Tooltip label={t(blockFolded ? 'flow.step.block.unfold' : 'flow.step.block.fold')} position="top">
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  aria-label={t(blockFolded ? 'flow.step.block.unfold' : 'flow.step.block.fold')}
                  aria-pressed={blockFolded}
                  data-block-fold=""
                  onClick={() => onToggleBlock(step.id)}
                >
                  {blockFolded ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
                </ActionIcon>
              </Tooltip>
            )}
            <InsertStepBelow flowId={flowId} at={index + 1} t={t} />
            {!END_MARKERS.includes(step.type) && (
              <>
                <Tooltip label={t('flow.step.moveUp')} position="top">
                  <ActionIcon variant="subtle" size="sm" disabled={index === 0} onClick={() => handleMove('up')}>
                    <ArrowUp size={14} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label={t('flow.step.moveDown')} position="top">
                  <ActionIcon variant="subtle" size="sm" disabled={index === total - 1} onClick={() => handleMove('down')}>
                    <ArrowDown size={14} />
                  </ActionIcon>
                </Tooltip>
              </>
            )}
            {!END_MARKERS.includes(step.type) && (
              <Tooltip label={t('flow.step.duplicate')} position="top">
                <ActionIcon variant="subtle" size="sm" aria-label={t('flow.step.duplicate')} onClick={() => duplicateStep(flowId, step.id)}>
                  <Copy size={14} />
                </ActionIcon>
              </Tooltip>
            )}
            <Tooltip label={t('flow.step.delete')} position="top">
              <ActionIcon variant="subtle" color="red" size="sm" onClick={handleDelete}>
                <Trash size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        {runError && (
          <Text className="selectable" fz="xs" c="var(--mantine-color-error)" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {runError}
          </Text>
        )}

        {open && (
          <>
            {showLabel && (
              <RenameInput
                label={t('flow.step.label')}
                value={step.label}
                onChange={(label) => updateStep(flowId, step.id, { label })}
                ai={nameSource}
                mode="field"
                size="xs"
              />
            )}

            <Box ref={configRef} onFocusCapture={handleFocusCapture} style={STEP_FORM_CONTAINER}>
              <ConfigEditor
                step={step}
                onChange={handleConfigChange}
                t={t}
                flowId={flowId}
                flowVariables={flowVariables}
                flowTrigger={flowTrigger}
                draftButton={draftButton}
                {...(insertInForm ? { insertData: insertDataMenu } : {})}
              />
            </Box>
            {!insertInForm && !NO_INSERT_DATA.has(step.type) && insertDataMenu}

            {stepHasOutput(step) && (
              <AppTextInput
                label={t('flow.step.outputKey')}
                description={t('flow.step.outputKey.hint')}
                value={step.outputKey}
                onChange={(e) => updateStep(flowId, step.id, { outputKey: e.currentTarget.value })}
                size="xs"
                error={outputKeyError ? t(`flow.step.outputKey.error.${outputKeyError}`) : undefined}
              />
            )}
          </>
        )}
      </Stack>
    </Paper>
  );
});
