import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextarea } from '../../../components/AppTextarea';
import type { SkillConfigProps } from './types';

export const TextConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => (
  <Stack gap="xs">
    <AppTextarea
      label={t('flow.skill.text.text')}
      placeholder={t('flow.skill.text.text.placeholder')}
      value={step.config.text ?? ''}
      onChange={(e) => onChange({ ...step.config, text: e.currentTarget.value })}
      minRows={3}
      autosize
      size="sm"
    />
    <Text fz="xs" c="dimmed">{t('flow.skill.text.hint')}</Text>
  </Stack>
);
