import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { StatusLine } from '../../../components/StatusLine';
import type { SkillConfigProps } from './types';
import { stopInLoop, useStepFacts } from './controlFacts';

const TOP_LEVEL = { inLoop: false };
const readPlace = (steps: Parameters<typeof stopInLoop>[0], index: number) => ({ inLoop: stopInLoop(steps, index) });

export const StopConfig: React.FC<SkillConfigProps> = ({ step, onChange, t, flowId }) => {
  const value = step.config.value ?? '';
  // Inside a loop it only skips the item; the loop and the steps after it go on.
  const { inLoop } = useStepFacts(flowId, step.id, readPlace, TOP_LEVEL);
  return (
    <Stack gap="xs">
      <Stack gap={4}>
        <AppTextInput
          label={t('flow.skill.stop.value')}
          placeholder={t('flow.skill.stop.value.placeholder')}
          value={value}
          onChange={(e) => onChange({ ...step.config, value: e.currentTarget.value })}
          size="sm"
        />
        {value.trim() === '' && <StatusLine tone="warning">{t('flow.skill.stop.value.empty')}</StatusLine>}
      </Stack>
      <Text fz="xs" c="var(--text-muted)" data-stop-hint={inLoop ? 'item' : 'run'}>
        {t(inLoop ? 'flow.skill.stop.hint.item' : 'flow.skill.stop.hint.run')}
      </Text>
    </Stack>
  );
};
