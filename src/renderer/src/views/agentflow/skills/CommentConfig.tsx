import React from 'react';
import { Stack } from '@mantine/core';
import { AppTextarea } from '../../../components/AppTextarea';
import type { SkillConfigProps } from './types';

export const CommentConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => (
  <Stack gap="xs">
    <AppTextarea
      label={t('agentflow.skill.comment.note')}
      description={t('agentflow.skill.comment.hint')}
      placeholder={t('agentflow.skill.comment.placeholder')}
      value={step.config.note ?? ''}
      onChange={(e) => onChange({ ...step.config, note: e.currentTarget.value })}
      minRows={3}
      resize="vertical"
      autosize
      size="sm"
    />
  </Stack>
);
