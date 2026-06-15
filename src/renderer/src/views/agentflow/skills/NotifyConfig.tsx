import React from 'react';
import { Stack } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppTextarea } from '../../../components/AppTextarea';
import type { SkillConfigProps } from './types';

export const NotifyConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => (
  <Stack gap="xs">
    <AppTextInput
      label={t('agentflow.skill.notify.title')}
      value={step.config.title ?? ''}
      onChange={(e) => onChange({ ...step.config, title: e.currentTarget.value })}
      size="sm"
    />
    <AppTextarea
      label={t('agentflow.skill.notify.body')}
      value={step.config.body ?? ''}
      onChange={(e) => onChange({ ...step.config, body: e.currentTarget.value })}
      minRows={2}
      autosize
      size="sm"
    />
  </Stack>
);
