import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { useGeminiChoices } from './useGeminiChoices';
import type { SkillConfigProps } from './types';

export const XMediaConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const reader = step.config.reader ?? '';
  const { groups, keys, loaded } = useGeminiChoices(reader);
  const noKey = loaded && groups.length === 0 && keys.length === 0;

  const readerOptions = [
    { value: '', label: t('flow.skill.x_media.reader.none') },
    { value: 'auto', label: t('flow.skill.x_media.reader.auto') },
    ...(groups.length > 0 ? [{ group: t('settings.byok.group.title'), items: groups }] : []),
    ...(keys.length > 0 ? [{ group: t('settings.byok.title'), items: keys }] : []),
  ];

  return (
    <Stack gap="xs">
      <AppTextInput
        label={t('flow.skill.x_media.input')}
        placeholder="{{input}}"
        value={step.config.input ?? ''}
        onChange={(e) => onChange({ ...step.config, input: e.currentTarget.value })}
        size="sm"
      />
      <SelectDropdown
        label={t('flow.skill.ytdl.destination')}
        description={t('flow.skill.x_media.destination.desc')}
        options={[
          { value: 'auto', label: t('flow.skill.x_media.destination.auto') },
          { value: 'telegram', label: t('flow.skill.ytdl.destination.telegram') },
          { value: 'line', label: t('flow.skill.x_media.destination.line') },
          { value: 'local', label: t('flow.skill.ytdl.destination.local') },
        ]}
        value={step.config.destination || 'auto'}
        onChange={(value) => onChange({ ...step.config, destination: value })}
        size="sm"
      />
      <AppTextInput
        label={t('flow.skill.youtube_download.folder')}
        placeholder={t('flow.skill.youtube_download.folder.placeholder')}
        value={step.config.folder ?? ''}
        onChange={(e) => onChange({ ...step.config, folder: e.currentTarget.value })}
        size="sm"
      />
      <SelectDropdown
        label={t('flow.skill.x_media.reader')}
        description={noKey ? t('flow.skill.youtube.fallback.needKey') : t('flow.skill.x_media.reader.desc')}
        options={readerOptions}
        value={reader}
        onChange={(value) => onChange({ ...step.config, reader: value })}
        size="sm"
      />
      <Text fz="xs" c="dimmed">
        {t('flow.skill.x_media.outputHint').replaceAll('{{outputKey}}', `{{${step.outputKey}}}`)}
      </Text>
    </Stack>
  );
};
