import React, { useRef, useState } from 'react';
import { Group, Stack } from '@mantine/core';
import { AppTextInput } from '../../components/AppTextInput';
import { AppButton } from '../../components/AppButton';
import { useFlowStore } from '../../store/useFlowStore';
import { fillTemplate } from '../../../../shared/fillTemplate';
import { countOutputReferences, renameOutputReferences } from '../../../../shared/flowOutputRename';
import type { OutputKeyError } from './skills/validation';
import type { SkillInstance } from '../../../../shared/types';

interface OutputKeyFieldProps {
  step: SkillInstance;
  flowId: string;
  error: OutputKeyError;
  t: (key: string) => string;
}

function flowSteps(flowId: string): SkillInstance[] {
  return useFlowStore.getState().flows.find((flow) => flow.id === flowId)?.steps ?? [];
}

/** Points every `{{from…}}` in the flow at `to`, one store update per step that has one. */
function carryReferences(flowId: string, from: string, to: string): void {
  const steps = flowSteps(flowId);
  const renamed = renameOutputReferences(steps, from, to);
  const { updateStep } = useFlowStore.getState();
  renamed.forEach((step, index) => {
    if (step !== steps[index]) updateStep(flowId, step.id, { config: step.config });
  });
}

/**
 * A step's output name. Leaving the field with another name offers to carry the flow's references
 * over to it (never done on its own, the same as a loop's variable): the steps that read the old
 * name would otherwise read nothing.
 */
export const OutputKeyField: React.FC<OutputKeyFieldProps> = ({ step, flowId, error, t }) => {
  const key = step.outputKey.trim();
  const keyAtFocus = useRef(key);
  const [renamedFrom, setRenamedFrom] = useState('');
  const staleRefs = useFlowStore((s) => {
    if (!renamedFrom) return 0;
    const steps = s.flows.find((flow) => flow.id === flowId)?.steps ?? [];
    // Another step making that name now: its readers are its own, not this step's.
    if (steps.some((other) => other.outputKey.trim() === renamedFrom)) return 0;
    return countOutputReferences(steps, renamedFrom);
  });
  const offer = renamedFrom !== '' && renamedFrom !== key && error === null && staleRefs > 0;

  return (
    <Stack gap={4}>
      <AppTextInput
        label={t('flow.step.outputKey')}
        description={t('flow.step.outputKey.hint')}
        value={step.outputKey}
        onChange={(e) => useFlowStore.getState().updateStep(flowId, step.id, { outputKey: e.currentTarget.value })}
        onFocus={() => { keyAtFocus.current = key; setRenamedFrom(''); }}
        onBlur={() => { if (keyAtFocus.current !== key) setRenamedFrom(keyAtFocus.current); }}
        size="xs"
        error={error ? t(`flow.step.outputKey.error.${error}`) : undefined}
      />
      {offer && (
        <Group gap={6} wrap="nowrap" data-output-rename="">
          <AppButton
            variant="subtle"
            size="compact-xs"
            onClick={() => {
              carryReferences(flowId, renamedFrom, key);
              setRenamedFrom('');
            }}
          >
            {fillTemplate(t('flow.step.outputKey.renameRefs'), { count: String(staleRefs), from: `{{${renamedFrom}}}`, to: `{{${key}}}` })}
          </AppButton>
        </Group>
      )}
    </Stack>
  );
};
