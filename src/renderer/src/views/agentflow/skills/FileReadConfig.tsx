import React from 'react';
import { Stack, Text } from '@mantine/core';
import { PathInput } from '../../../components/PathInput';
import type { SkillConfigProps } from './types';

export const FileReadConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => (
  <Stack gap="xs">
    <PathInput
      label={t('agentflow.skill.file_read.path')}
      placeholder={t('agentflow.skill.file_read.path.placeholder')}
      browseLabel={t('agentflow.path.browse')}
      mode="file"
      value={step.config.path ?? ''}
      onChange={(path) => onChange({ ...step.config, path })}
      size="sm"
    />
    <Text fz="xs" c="dimmed">{t('agentflow.skill.file_read.hint')}</Text>
  </Stack>
);
