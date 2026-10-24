import React from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { AppTextInput } from '../../../components/AppTextInput';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import { ALMANAC_ACTIVITY_PRESETS, MAX_ALMANAC_DAYS, MAX_ALMANAC_FILTER_DAYS } from '../../../../../shared/almanac';
import type { SkillConfigProps } from './types';

/**
 * The almanac step: which day (Gregorian, or a lunar date), how many days, and optionally an
 * activity to keep only the good days for. An activity the AI wrote that is not a preset stays
 * selectable as itself.
 */
export const AlmanacConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const lunar = step.config.lunar === 'true';
  const activity = (step.config.activity ?? '').trim();
  const filtered = Boolean(activity) || Boolean((step.config.zodiac ?? '').trim()) || step.config.weekends === 'true';
  const presets = ALMANAC_ACTIVITY_PRESETS.map((item) => ({
    value: item.term,
    label: t(`flow.skill.almanac.activity.${item.id}`),
  }));
  const activityOptions = [
    { value: '', label: t('flow.skill.almanac.activity.none') },
    ...presets,
    ...(activity && !presets.some((item) => item.value === activity) ? [{ value: activity, label: activity }] : []),
  ];

  return (
    <Stack gap="xs">
      <AppTextInput
        label={t('flow.skill.almanac.date')}
        placeholder={t(lunar ? 'flow.skill.almanac.date.lunarPlaceholder' : 'flow.skill.almanac.date.placeholder')}
        value={step.config.date ?? ''}
        onChange={(e) => onChange({ ...step.config, date: e.currentTarget.value })}
        size="sm"
      />
      <ToggleSwitch
        label={t('flow.skill.almanac.lunar')}
        size="sm"
        checked={lunar}
        onChange={(e) => onChange({ ...step.config, lunar: e.currentTarget.checked ? 'true' : 'false' })}
      />
      {lunar && (
        <ToggleSwitch
          label={t('flow.skill.almanac.leap')}
          size="sm"
          checked={step.config.leap === 'true'}
          onChange={(e) => onChange({ ...step.config, leap: e.currentTarget.checked ? 'true' : 'false' })}
        />
      )}
      <AppTextInput
        label={t('flow.skill.almanac.time')}
        placeholder={t('flow.skill.almanac.time.placeholder')}
        value={step.config.time ?? ''}
        onChange={(e) => onChange({ ...step.config, time: e.currentTarget.value })}
        size="sm"
      />

      <Group grow gap="xs" align="flex-start">
        <AppNumberInput
          label={t('flow.skill.almanac.days')}
          value={step.config.days ?? '1'}
          onChange={(v) => onChange({ ...step.config, days: v === '' ? '' : String(v) })}
          size="sm"
          min={1}
          max={filtered ? MAX_ALMANAC_FILTER_DAYS : MAX_ALMANAC_DAYS}
          step={1}
          allowDecimal={false}
          allowNegative={false}
        />
        <SelectDropdown
          label={t('flow.skill.almanac.activity')}
          options={activityOptions}
          value={activity}
          onChange={(next) => onChange({ ...step.config, activity: next ?? '' })}
          size="sm"
        />
      </Group>
      <AppTextInput
        label={t('flow.skill.almanac.zodiac')}
        placeholder={t('flow.skill.almanac.zodiac.placeholder')}
        value={step.config.zodiac ?? ''}
        onChange={(e) => onChange({ ...step.config, zodiac: e.currentTarget.value })}
        size="sm"
      />
      <ToggleSwitch
        label={t('flow.skill.almanac.weekends')}
        size="sm"
        checked={step.config.weekends === 'true'}
        onChange={(e) => onChange({ ...step.config, weekends: e.currentTarget.checked ? 'true' : 'false' })}
      />

      <Text fz="xs" c="dimmed">
        {fillTemplate(t('flow.skill.almanac.outputHint'), {
          value: `{{${step.outputKey}}}`,
          text: `{{${step.outputKey}.text}}`,
          lunar: `{{${step.outputKey}.lunar}}`,
        })}
      </Text>
    </Stack>
  );
};
