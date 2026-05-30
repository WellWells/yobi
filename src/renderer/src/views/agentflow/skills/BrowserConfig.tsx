import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import type { SkillConfigProps } from './types';

function isValidUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return true;
  if (/^\{\{[^}]+\}\}$/.test(trimmed)) return true;
  return /^https?:\/\//i.test(trimmed);
}

export const BrowserConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const url = step.config.url ?? '';
  const urlError = !isValidUrl(url);

  return (
    <Stack gap="xs">
      <AppTextInput
        label={t('agentflow.skill.browser.url')}
        placeholder={t('agentflow.skill.browser.url.placeholder')}
        value={url}
        onChange={(e) => onChange({ ...step.config, url: e.currentTarget.value })}
        size="sm"
        error={urlError ? t('agentflow.skill.browser.url.error') : undefined}
      />

      <Text fz="xs" c="dimmed">
        {t('agentflow.skill.browser.outputHint').replace('{{outputKey}}', `{{${step.outputKey}}}`)}
      </Text>
    </Stack>
  );
};
