import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { PathInput } from '../../../components/PathInput';
import type { SkillConfigProps } from './types';

export const RunConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => (
  <Stack gap="xs">
    <PathInput
      label={t('agentflow.skill.run.path')}
      placeholder={t('agentflow.skill.run.path.placeholder')}
      browseLabel={t('agentflow.path.browse')}
      value={step.config.path ?? ''}
      onChange={(path) => onChange({ ...step.config, path })}
      size="sm"
    />
    <AppTextInput
      label={t('agentflow.skill.run.args')}
      placeholder={t('agentflow.skill.run.args.placeholder')}
      value={step.config.args ?? ''}
      onChange={(e) => onChange({ ...step.config, args: e.currentTarget.value })}
      size="sm"
      mono
    />
    <Text fz="xs" c="dimmed">{t('agentflow.skill.run.hint')}</Text>
  </Stack>
);
