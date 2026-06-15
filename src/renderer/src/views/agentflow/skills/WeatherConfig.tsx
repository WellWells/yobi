import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { SelectDropdown } from '../../../components/SelectDropdown';
import type { SkillConfigProps } from './types';

export const WeatherConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => (
  <Stack gap="xs">
    <AppTextInput
      label={t('agentflow.skill.weather.location')}
      placeholder={t('agentflow.skill.weather.location.placeholder')}
      value={step.config.location ?? ''}
      onChange={(e) => onChange({ ...step.config, location: e.currentTarget.value })}
      size="sm"
    />
    <SelectDropdown
      label={t('agentflow.skill.weather.units')}
      options={[
        { value: 'metric', label: t('agentflow.skill.weather.units.metric') },
        { value: 'imperial', label: t('agentflow.skill.weather.units.imperial') },
      ]}
      value={step.config.units ?? 'metric'}
      onChange={(value) => onChange({ ...step.config, units: value })}
      size="sm"
    />
    <Text fz="xs" c="dimmed">{t('agentflow.skill.weather.source')}</Text>
  </Stack>
);
