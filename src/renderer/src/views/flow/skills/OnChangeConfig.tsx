import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import type { SkillConfigProps } from './types';

export const OnChangeConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => (
  <Stack gap="xs">
    <AppTextInput
      label={t('flow.skill.on_change.value')}
      placeholder={t('flow.skill.on_change.value.placeholder')}
      value={step.config.value ?? ''}
      onChange={(e) => onChange({ ...step.config, value: e.currentTarget.value })}
      size="sm"
    />
    <Text fz="xs" c="dimmed">
      {t('flow.skill.on_change.hint')}
    </Text>
  </Stack>
);
