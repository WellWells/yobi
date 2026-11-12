import React, { useCallback, useRef, useState } from 'react';
import { Group, Input, SimpleGrid, Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { AppButton } from '../../../components/AppButton';
import { StatusLine } from '../../../components/StatusLine';
import { useFlowStore } from '../../../store/useFlowStore';
import { renameReferences } from '../../../store/flowHelpers';
import type { SkillConfigProps } from './types';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import { loopVarName } from '../../../../../shared/flowBlockStructure';
import { loopFacts, loopVarRefCount, loopVarRefSteps, useStepFacts, type LoopFacts } from './controlFacts';

/** Side by side from this card width; the 560px column of today keeps them stacked. */
const SIDE_BY_SIDE_FROM = '640px';
const NO_FACTS: LoopFacts = { varProblem: '', varConflict: '', source: '', fields: '', exampleFields: '', plain: false, notList: false };
const NO_COUNT = { count: 0 };

/** Rewrites `{{from…}}` to `{{to…}}` in the loop's own body (not in inner loops that rebind `from`). */
function renameInBody(flowId: string, loopId: string, from: string, to: string): void {
  const store = useFlowStore.getState();
  const steps = store.flows.find((flow) => flow.id === flowId)?.steps ?? [];
  const index = steps.findIndex((step) => step.id === loopId);
  if (index < 0) return;
  const renames = new Map([[from, to]]);
  for (const { index: at } of loopVarRefSteps(steps, index, from)) {
    const step = steps[at];
    const config = Object.fromEntries(Object.entries(step.config).map(([key, value]) => [key, renameReferences(value, renames)]));
    store.updateStep(flowId, step.id, { config });
  }
}

export const LoopConfig: React.FC<SkillConfigProps> = ({ step, onChange, t, flowId }) => {
  const input = step.config.input ?? '';
  const loopVar = step.config.loopVar ?? 'item';
  const name = loopVarName(step);
  const limitIterations = step.config.limitIterations !== 'false';
  const maxIterationsVal = step.config.maxIterations ? parseInt(step.config.maxIterations, 10) : 5;

  const readFacts = useCallback((steps: Parameters<typeof loopFacts>[0], index: number) => loopFacts(steps, index, t), [t]);
  const facts = useStepFacts(flowId, step.id, readFacts, NO_FACTS);

  // The name the field had when it got the focus: leaving it with another name offers to carry
  // the body's references over (never done on its own).
  const nameAtFocus = useRef(name);
  const [renamedFrom, setRenamedFrom] = useState('');
  const readCount = useCallback(
    (steps: Parameters<typeof loopFacts>[0], index: number) => ({ count: renamedFrom ? loopVarRefCount(steps, index, renamedFrom) : 0 }),
    [renamedFrom],
  );
  const { count: staleRefs } = useStepFacts(flowId, step.id, readCount, NO_COUNT);
  const offerRename = Boolean(flowId) && renamedFrom !== '' && renamedFrom !== name && staleRefs > 0 && facts.varProblem !== 'format';

  const token = `{{${name}}}`;
  const examples = facts.exampleFields.split(',').filter(Boolean).map((field) => `{{${name}.${field}}}`).join(t('flow.summary.sep'));
  let hint = fillTemplate(t('flow.skill.loop.hint.each'), { var: token });
  if (examples) hint = fillTemplate(t('flow.skill.loop.hint.fields'), { var: token, examples });

  let sourceLine: React.ReactNode = null;
  if (facts.notList) {
    sourceLine = <StatusLine tone="warning">{fillTemplate(t('flow.skill.loop.source.notList'), { source: facts.source })}</StatusLine>;
  } else if (facts.source) {
    let text = fillTemplate(t('flow.skill.loop.source'), { source: facts.source });
    if (facts.fields) text = fillTemplate(t('flow.skill.loop.source.fields'), { source: facts.source, fields: facts.fields });
    else if (facts.plain) text = fillTemplate(t('flow.skill.loop.source.plain'), { source: facts.source });
    sourceLine = <Text fz="xs" c="var(--text-muted)" data-loop-source="">{text}</Text>;
  }

  const varError = facts.varProblem === 'format' || facts.varProblem === 'reserved'
    ? fillTemplate(t(`flow.skill.loop.loopVar.error.${facts.varProblem}`), { name })
    : undefined;
  const varWarning = facts.varProblem === 'outer' || facts.varProblem === 'output'
    ? fillTemplate(t(`flow.skill.loop.loopVar.warning.${facts.varProblem}`), { token, step: facts.varConflict })
    : undefined;

  const limitLabel = fillTemplate(t('flow.skill.loop.limit.aria'), { count: String(maxIterationsVal) });

  return (
    <Stack gap="xs">
      <Stack gap={4}>
        <AppTextInput
          label={t('flow.skill.loop.input')}
          placeholder={t('flow.skill.loop.input.placeholder')}
          value={input}
          onChange={(e) => onChange({ ...step.config, input: e.currentTarget.value })}
          size="sm"
        />
        {sourceLine}
      </Stack>

      <SimpleGrid type="container" cols={{ base: 1, [SIDE_BY_SIDE_FROM]: 2 }} spacing="xs" verticalSpacing="xs">
        <Stack gap={4}>
          <AppTextInput
            label={t('flow.skill.loop.loopVar')}
            placeholder={t('flow.skill.loop.loopVar.placeholder')}
            value={loopVar}
            onChange={(e) => onChange({ ...step.config, loopVar: e.currentTarget.value })}
            onFocus={() => { nameAtFocus.current = name; setRenamedFrom(''); }}
            onBlur={() => { if (nameAtFocus.current !== name) setRenamedFrom(nameAtFocus.current); }}
            error={varError}
            mono
            size="sm"
          />
          {varWarning && <StatusLine tone="warning">{varWarning}</StatusLine>}
          {offerRename && (
            <Group gap={6} wrap="nowrap" data-loop-rename="">
              <AppButton
                variant="subtle"
                size="compact-xs"
                onClick={() => {
                  if (flowId) renameInBody(flowId, step.id, renamedFrom, name);
                  setRenamedFrom('');
                }}
              >
                {fillTemplate(t('flow.skill.loop.renameRefs'), { count: String(staleRefs), from: `{{${renamedFrom}}}`, to: token })}
              </AppButton>
            </Group>
          )}
        </Stack>

        <Stack gap={4}>
          <Input.Label>{t('flow.skill.loop.limitIterations')}</Input.Label>
          <Group gap="xs" wrap="nowrap" align="center">
            <ToggleSwitch
              checked={limitIterations}
              aria-label={limitLabel}
              onChange={(e) => onChange({ ...step.config, limitIterations: e.currentTarget.checked ? 'true' : 'false' })}
            />
            <Text fz="sm" c={limitIterations ? undefined : 'var(--text-muted)'}>{t('flow.skill.loop.limit.before')}</Text>
            <AppNumberInput
              aria-label={t('flow.skill.loop.maxIterations')}
              placeholder="5"
              value={maxIterationsVal}
              onChange={(val) => onChange({ ...step.config, maxIterations: String(val || 5) })}
              min={1}
              disabled={!limitIterations}
              w={80}
              size="sm"
            />
            <Text fz="sm" c={limitIterations ? undefined : 'var(--text-muted)'}>{t('flow.skill.loop.limit.after')}</Text>
          </Group>
        </Stack>
      </SimpleGrid>

      <Text fz="xs" c="var(--text-muted)">{hint}</Text>
    </Stack>
  );
};
