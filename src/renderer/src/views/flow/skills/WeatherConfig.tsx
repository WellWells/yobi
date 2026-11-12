import React from 'react';
import { Group, Input, Stack, Text } from '@mantine/core';
import { AppSegmentedControl } from '../../../components/AppSegmentedControl';
import { AppTextInput } from '../../../components/AppTextInput';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import { QuickValueButtons } from './QuickValueButtons';
import { forecastRefusal, refusalText } from './lookupChecks';
import type { SkillConfigProps } from './types';

/**
 * The weather step: where, which day (blank = now; a day or a span = an hourly forecast), which
 * hours, and the units last since most people never change them.
 */
export const WeatherConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const date = step.config.date ?? '';
  const dated = Boolean(date.trim() || (step.config.hours ?? '').trim());
  const refusal = forecastRefusal(step.config);
  const units = step.config.units === 'imperial' ? 'imperial' : 'metric';

  return (
    <Stack gap="xs">
      <AppTextInput
        label={t('flow.skill.weather.location')}
        placeholder={t('flow.skill.weather.location.placeholder')}
        value={step.config.location ?? ''}
        onChange={(e) => onChange({ ...step.config, location: e.currentTarget.value })}
        size="sm"
      />
      <Group grow gap="xs" align="flex-start">
        <AppTextInput
          label={t('flow.skill.weather.date')}
          placeholder={t('flow.skill.weather.date.placeholder')}
          value={date}
          onChange={(e) => onChange({ ...step.config, date: e.currentTarget.value })}
          size="sm"
          error={refusalText(refusal, 'date', t)}
        />
        <AppTextInput
          label={t('flow.skill.weather.hours')}
          placeholder={t('flow.skill.weather.hours.placeholder')}
          value={step.config.hours ?? ''}
          onChange={(e) => onChange({ ...step.config, hours: e.currentTarget.value })}
          size="sm"
          error={refusalText(refusal, 'hours', t)}
        />
      </Group>
      <QuickValueButtons
        label={t('flow.skill.weather.date')}
        values={[
          { value: '', label: t('flow.summary.weather.now') },
          { value: 'today', label: t('flow.summary.today') },
          { value: 'tomorrow', label: t('flow.summary.tomorrow') },
          { value: '+2', label: fillTemplate(t('flow.summary.daysLater'), { count: '2' }) },
        ]}
        current={date}
        onPick={(value) => onChange({ ...step.config, date: value })}
      />
      {dated && <Text fz="xs" c="var(--text-muted)">{t('flow.skill.weather.forecastFields')}</Text>}
      <Input.Wrapper label={t('flow.skill.weather.units')}>
        <AppSegmentedControl
          value={units}
          onChange={(value) => onChange({ ...step.config, units: value })}
          options={[
            { value: 'metric', label: t('flow.skill.weather.units.metric') },
            { value: 'imperial', label: t('flow.skill.weather.units.imperial') },
          ]}
          fullWidth={false}
          size="sm"
        />
      </Input.Wrapper>
      <Text fz="xs" c="var(--text-muted)">{t('flow.skill.weather.source')}</Text>
    </Stack>
  );
};
