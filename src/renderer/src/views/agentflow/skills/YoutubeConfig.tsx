import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { isValidYoutubeUrlOrVar } from './validation';
import type { SkillConfigProps } from './types';

export const YoutubeConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const url = step.config.url ?? '';
  const urlError = !isValidYoutubeUrlOrVar(url);
  return (
    <Stack gap="xs">
      <AppTextInput
        label={t('agentflow.skill.youtube.url')}
        placeholder={t('agentflow.skill.youtube.url.placeholder')}
        value={url}
        onChange={(e) => onChange({ ...step.config, url: e.currentTarget.value })}
        size="sm"
        error={urlError ? t('agentflow.skill.youtube.url.error') : undefined}
      />
      <Text fz="xs" c="dimmed">{t('agentflow.skill.youtube.hint')}</Text>
    </Stack>
  );
};
