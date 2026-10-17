import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { useGeminiChoices } from './useGeminiChoices';
import { isValidYoutubeUrlOrVar } from './validation';
import type { SkillConfigProps } from './types';

export const YoutubeConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const url = step.config.url ?? '';
  const urlError = !isValidYoutubeUrlOrVar(url);
  const fallback = step.config.fallbackProvider ?? '';

  const { groups, keys, loaded } = useGeminiChoices(fallback);
  const noKey = loaded && groups.length === 0 && keys.length === 0;

  const fallbackOptions = [
    { value: '', label: t('flow.skill.youtube.fallback.none') },
    ...(groups.length > 0 ? [{ group: t('settings.byok.group.title'), items: groups }] : []),
    ...(keys.length > 0 ? [{ group: t('settings.byok.title'), items: keys }] : []),
  ];

  return (
    <Stack gap="xs">
      <AppTextInput
        label={t('flow.skill.youtube.url')}
        placeholder={t('flow.skill.youtube.url.placeholder')}
        value={url}
        onChange={(e) => onChange({ ...step.config, url: e.currentTarget.value })}
        size="sm"
        error={urlError ? t('flow.skill.youtube.url.error') : undefined}
      />
      <SelectDropdown
        label={t('flow.skill.youtube.fallback')}
        description={noKey ? t('flow.skill.youtube.fallback.needKey') : t('flow.skill.youtube.fallback.desc')}
        options={fallbackOptions}
        value={fallback}
        onChange={(value) => onChange({ ...step.config, fallbackProvider: value })}
        disabled={noKey && !fallback}
        size="sm"
      />
      <Text fz="xs" c="dimmed">{t('flow.skill.youtube.hint')}</Text>
    </Stack>
  );
};
