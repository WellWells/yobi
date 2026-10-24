import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { SettingRow } from '../../../components/SettingRow';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import type { SkillConfigProps } from './types';

export const YoutubeInfoConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => (
  <Stack gap="xs">
    <AppTextInput
      label={t('flow.skill.youtube_info.input')}
      placeholder={t('flow.skill.youtube_info.input.placeholder')}
      value={step.config.input ?? ''}
      onChange={(e) => onChange({ ...step.config, input: e.currentTarget.value })}
      size="sm"
    />
    <SelectDropdown
      label={t('flow.skill.ytdl.destination')}
      description={t('flow.skill.youtube_info.destination.desc')}
      options={[
        { value: 'auto', label: t('flow.skill.ytdl.destination.auto') },
        { value: 'telegram', label: t('flow.skill.ytdl.destination.telegram') },
        { value: 'local', label: t('flow.skill.ytdl.destination.local') },
      ]}
      value={step.config.destination || 'auto'}
      onChange={(value) => onChange({ ...step.config, destination: value })}
      size="sm"
    />
    <SettingRow
      label={t('flow.skill.browser.emitFailFlag')}
      hint={t('flow.skill.browser.emitFailFlag.hint')}
      control={
        <ToggleSwitch
          checked={step.config.emitFailFlag === 'true'}
          onChange={(e) => onChange({ ...step.config, emitFailFlag: e.currentTarget.checked ? 'true' : 'false' })}
        />
      }
    />
    <Text fz="xs" c="dimmed">{t('flow.skill.youtube_info.hint')}</Text>
  </Stack>
);
