import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppTextarea } from '../../../components/AppTextarea';
import { PathInput } from '../../../components/PathInput';
import type { SkillConfigProps } from './types';

export const FileWriteConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => (
  <Stack gap="xs">
    <AppTextarea
      label={t('agentflow.skill.file_write.content')}
      placeholder={t('agentflow.skill.file_write.content.placeholder')}
      value={step.config.content ?? ''}
      onChange={(e) => onChange({ ...step.config, content: e.currentTarget.value })}
      minRows={3}
      autosize
      size="sm"
    />
    <AppTextInput
      label={t('agentflow.skill.file_write.filename')}
      placeholder={t('agentflow.skill.file_write.filename.placeholder')}
      value={step.config.filename ?? ''}
      onChange={(e) => onChange({ ...step.config, filename: e.currentTarget.value })}
      size="sm"
      mono
    />
    <PathInput
      label={t('agentflow.skill.file_write.folder')}
      placeholder={t('agentflow.skill.file_write.folder.placeholder')}
      browseLabel={t('agentflow.path.browse')}
      mode="folder"
      value={step.config.folder ?? ''}
      onChange={(folder) => onChange({ ...step.config, folder })}
      size="sm"
    />
    <Text fz="xs" c="dimmed">{t('agentflow.skill.file_write.hint')}</Text>
  </Stack>
);
