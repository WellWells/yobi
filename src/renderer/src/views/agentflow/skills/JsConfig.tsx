import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextarea } from '../../../components/AppTextarea';
import type { SkillConfigProps } from './types';

export const JsConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => (
  <Stack gap="xs">
    <AppTextarea
      label={t('agentflow.skill.js.code')}
      placeholder={t('agentflow.skill.js.code.placeholder')}
      value={step.config.code ?? ''}
      onChange={(e) => onChange({ ...step.config, code: e.currentTarget.value })}
      minRows={6}
      autosize
      mono
      size="sm"
    />
    <Text fz="xs" c="dimmed">{t('agentflow.skill.js.hint')}</Text>
    <Text fz="xs" c="dimmed">
      {t('agentflow.skill.browser.outputHint').replace('{{outputKey}}', `{{${step.outputKey}}}`)}
    </Text>
  </Stack>
);
