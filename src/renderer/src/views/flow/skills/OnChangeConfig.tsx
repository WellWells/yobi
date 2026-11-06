import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { SettingRow } from '../../../components/SettingRow';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import type { SkillConfigProps } from './types';

export const OnChangeConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => (
  <Stack gap="xs">
    <AppTextInput
      label={t('flow.skill.on_change.value')}
      placeholder={t('flow.skill.on_change.value.placeholder')}
      value={step.config.value ?? ''}
      onChange={(e) => onChange({ ...step.config, value: e.currentTarget.value })}
      size="sm"
    />
    <SettingRow
      label={t('flow.skill.on_change.withDiff')}
      hint={fillTemplate(t('flow.skill.on_change.withDiff.hint'), { diff: `{{${step.outputKey}.diff}}` })}
      control={
        <ToggleSwitch
          checked={step.config.withDiff === 'true'}
          onChange={(e) => onChange({ ...step.config, withDiff: e.currentTarget.checked ? 'true' : 'false' })}
        />
      }
    />
    <Text fz="xs" c="dimmed">
      {t('flow.skill.on_change.hint')}
    </Text>
  </Stack>
);
