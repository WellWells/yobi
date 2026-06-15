import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import type { SkillConfigProps } from './types';

export const StopConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => (
  <Stack gap="xs">
    <AppTextInput
      label={t('agentflow.skill.stop.value')}
      placeholder={t('agentflow.skill.stop.value.placeholder')}
      value={step.config.value ?? ''}
      onChange={(e) => onChange({ ...step.config, value: e.currentTarget.value })}
      size="sm"
    />
    <Text fz="xs" c="dimmed">
      {t('agentflow.skill.stop.hint')}
    </Text>
  </Stack>
);
