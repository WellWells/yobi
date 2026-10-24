import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { SettingRow } from '../../../components/SettingRow';
import type { SkillConfigProps } from './types';
import { fillTemplate } from '../../../../../shared/fillTemplate';

export const BrowserOpenConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => (
  <Stack gap="xs">
    <AppTextInput
      label={t('flow.skill.browser_open.url')}
      placeholder={t('flow.skill.browser_open.url.placeholder')}
      value={step.config.url ?? ''}
      onChange={(e) => onChange({ ...step.config, url: e.currentTarget.value })}
      size="sm"
    />

    <SettingRow
      label={t('flow.skill.browser_open.show')}
      hint={t('flow.skill.browser_open.show.hint')}
      control={
        <ToggleSwitch
          checked={step.config.show === 'true'}
          onChange={(e) => onChange({ ...step.config, show: e.currentTarget.checked ? 'true' : 'false' })}
        />
      }
    />

    <Text fz="xs" c="dimmed">
      {fillTemplate(t('flow.skill.browser_open.hint'), { outputKey: `{{${step.outputKey}}}` })}
    </Text>
  </Stack>
);
