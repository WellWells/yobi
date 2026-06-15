import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import type { SkillConfigProps } from './types';

export const FileDeleteConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => (
  <Stack gap="xs">
    <AppTextInput
      label={t('agentflow.skill.file_delete.path')}
      placeholder={t('agentflow.skill.file_delete.path.placeholder')}
      value={step.config.path ?? ''}
      onChange={(e) => onChange({ ...step.config, path: e.currentTarget.value })}
      size="sm"
      mono
    />
    <Text fz="xs" c="dimmed">{t('agentflow.skill.file_delete.hint')}</Text>
  </Stack>
);
