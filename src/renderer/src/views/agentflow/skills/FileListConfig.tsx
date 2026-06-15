import React from 'react';
import { Stack, Text } from '@mantine/core';
import { PathInput } from '../../../components/PathInput';
import type { SkillConfigProps } from './types';

export const FileListConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => (
  <Stack gap="xs">
    <PathInput
      label={t('agentflow.skill.file_list.directory')}
      placeholder={t('agentflow.skill.file_list.directory.placeholder')}
      browseLabel={t('agentflow.path.browse')}
      mode="folder"
      value={step.config.directory ?? ''}
      onChange={(directory) => onChange({ ...step.config, directory })}
      size="sm"
    />
    <Text fz="xs" c="dimmed">{t('agentflow.skill.file_list.hint')}</Text>
  </Stack>
);
