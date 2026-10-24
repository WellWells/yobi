import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { SettingRow } from '../../../components/SettingRow';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { isValidYoutubeUrlOrVar } from './validation';
import { YtdlToolsNotice } from './YtdlToolsNotice';
import type { SkillConfigProps } from './types';
import { fillTemplate } from '../../../../../shared/fillTemplate';

export const YoutubeDownloadConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const url = step.config.url ?? '';
  const urlError = url.trim() !== '' && !isValidYoutubeUrlOrVar(url);
  return (
    <Stack gap="xs">
      <YtdlToolsNotice t={t} />
      <AppTextInput
        label={t('flow.skill.youtube.url')}
        placeholder={t('flow.skill.youtube.url.placeholder')}
        value={url}
        onChange={(e) => onChange({ ...step.config, url: e.currentTarget.value })}
        size="sm"
        error={urlError ? t('flow.skill.youtube.url.error') : undefined}
      />
      <AppTextInput
        label={t('flow.skill.youtube_download.quality')}
        placeholder={t('flow.skill.youtube_download.quality.placeholder')}
        value={step.config.quality ?? ''}
        onChange={(e) => onChange({ ...step.config, quality: e.currentTarget.value })}
        size="sm"
      />
      <SelectDropdown
        label={t('flow.skill.ytdl.destination')}
        description={t('flow.skill.youtube_download.destination.desc')}
        options={[
          { value: 'auto', label: t('flow.skill.ytdl.destination.auto') },
          { value: 'telegram', label: t('flow.skill.ytdl.destination.telegram') },
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
      <SettingRow
        label={t('flow.skill.browser.emitFailFlag')}
        hint={fillTemplate(t('flow.skill.youtube_download.emitFailFlag.hint'), { flag: `{{${step.outputKey}.isFailed}}` })}
        control={
          <ToggleSwitch
            checked={step.config.emitFailFlag === 'true'}
            onChange={(e) => onChange({ ...step.config, emitFailFlag: e.currentTarget.checked ? 'true' : 'false' })}
          />
        }
      />
      <Text fz="xs" c="dimmed">{t('flow.skill.youtube_download.hint')}</Text>
    </Stack>
  );
};
