import React from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { SelectDropdown } from '../../../components/SelectDropdown';
import type { SkillConfigProps } from './types';

export const WeatherConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => (
  <Stack gap="xs">
    <AppTextInput
      label={t('flow.skill.weather.location')}
      placeholder={t('flow.skill.weather.location.placeholder')}
      value={step.config.location ?? ''}
      onChange={(e) => onChange({ ...step.config, location: e.currentTarget.value })}
      size="sm"
    />
    <Text fz="xs" c="dimmed">{t('flow.skill.weather.location.hint')}</Text>
    <SelectDropdown
      label={t('flow.skill.weather.units')}
      options={[
        { value: 'metric', label: t('flow.skill.weather.units.metric') },
        { value: 'imperial', label: t('flow.skill.weather.units.imperial') },
      ]}
      value={step.config.units ?? 'metric'}
      onChange={(value) => onChange({ ...step.config, units: value })}
      size="sm"
    />
    <Group grow gap="xs">
      <AppTextInput
        label={t('flow.skill.weather.date')}
        placeholder={t('flow.skill.weather.date.placeholder')}
        value={step.config.date ?? ''}
        onChange={(e) => onChange({ ...step.config, date: e.currentTarget.value })}
        size="sm"
      />
      <AppTextInput
        label={t('flow.skill.weather.hours')}
        placeholder={t('flow.skill.weather.hours.placeholder')}
        value={step.config.hours ?? ''}
        onChange={(e) => onChange({ ...step.config, hours: e.currentTarget.value })}
        size="sm"
      />
    </Group>
    <Text fz="xs" c="dimmed">{t('flow.skill.weather.date.hint')}</Text>
    <Text fz="xs" c="dimmed">{t('flow.skill.weather.source')}</Text>
  </Stack>
);
