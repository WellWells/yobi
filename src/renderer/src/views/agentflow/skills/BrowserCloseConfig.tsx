import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import type { SkillConfigProps } from './types';

export const BrowserCloseConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => (
  <Stack gap="xs">
    <AppTextInput
      label={t('agentflow.skill.browser_close.page')}
      placeholder={t('agentflow.skill.browser_close.page.placeholder')}
      value={step.config.page ?? ''}
      onChange={(e) => onChange({ ...step.config, page: e.currentTarget.value })}
      size="sm"
      mono
    />

    <Text fz="xs" c="dimmed">{t('agentflow.skill.browser_close.hint')}</Text>
  </Stack>
);
