import React, { useEffect, useMemo, useState } from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { calendarApi } from '../../../api/electronApi';
import { useAppStore } from '../../../store/appStore';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import {
  CALENDAR_STEP_RANGES, DEFAULT_CALENDAR_MAX_EVENTS, MAX_CALENDAR_MAX_EVENTS, calendarNameKey,
} from '../../../../../shared/calendars';
import type { CalendarSummary } from '../../../../../shared/calendars';
import type { SkillConfigProps } from './types';

/**
 * The calendar step: which subscribed calendar (stored by id; the address stays in Settings),
 * which days, how many events. A name the AI wrote, or an id from another machine, stays
 * selectable as itself until the person picks one of theirs.
 */
export const CalendarConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const currentView = useAppStore((s) => s.currentView);
  const [calendars, setCalendars] = useState<CalendarSummary[]>([]);

  useEffect(() => {
    if (currentView !== 'flow') return;
    void calendarApi.list().then(setCalendars);
  }, [currentView]);

  const value = (step.config.calendar ?? '').trim();
  const options = useMemo(() => {
    const known = calendars.map((calendar) => ({ value: calendar.id, label: calendar.name }));
    const matches = calendars.some((calendar) => calendar.id === value || calendarNameKey(calendar.name) === calendarNameKey(value));
    return value && !matches ? [...known, { value, label: value }] : known;
  }, [calendars, value]);
  // A name that matches a calendar shows as that calendar.
  const selected = calendars.find((calendar) => calendarNameKey(calendar.name) === calendarNameKey(value))?.id ?? value;
  const range = step.config.range || 'today';

  return (
    <Stack gap="xs">
      <Stack gap={4}>
        <SelectDropdown
          label={t('flow.skill.calendar.calendar')}
          placeholder={calendars.length === 0 ? t('flow.skill.calendar.calendar.none') : t('flow.skill.calendar.calendar.placeholder')}
          options={options}
          value={selected || null}
          onChange={(next) => onChange({ ...step.config, calendar: next })}
          size="sm"
        />
        <Text fz="xs" c="dimmed">{t('flow.skill.calendar.calendar.hint')}</Text>
      </Stack>

      <Group grow gap="xs" align="flex-start">
        <SelectDropdown
          label={t('flow.skill.calendar.range')}
          options={CALENDAR_STEP_RANGES.map((item) => ({ value: item, label: t(`flow.skill.calendar.range.${item}`) }))}
          value={range}
          onChange={(next) => onChange({ ...step.config, range: next })}
          size="sm"
        />
        {range === 'days' && (
          <AppNumberInput
            label={t('flow.skill.calendar.days')}
            value={step.config.days ?? '7'}
            onChange={(v) => onChange({ ...step.config, days: v === '' ? '' : String(v) })}
            size="sm"
            min={1}
            max={31}
            step={1}
            allowDecimal={false}
            allowNegative={false}
          />
        )}
        <AppNumberInput
          label={t('flow.skill.calendar.maxEvents')}
          value={step.config.maxEvents ?? String(DEFAULT_CALENDAR_MAX_EVENTS)}
          onChange={(v) => onChange({ ...step.config, maxEvents: v === '' ? '' : String(v) })}
          size="sm"
          min={1}
          max={MAX_CALENDAR_MAX_EVENTS}
          step={1}
          allowDecimal={false}
          allowNegative={false}
        />
      </Group>

      <ToggleSwitch
        label={t('flow.skill.calendar.emitFailFlag')}
        size="sm"
        checked={step.config.emitFailFlag === 'true'}
        onChange={(e) => onChange({ ...step.config, emitFailFlag: e.currentTarget.checked ? 'true' : 'false' })}
      />
      {step.config.emitFailFlag === 'true' && (
        <Text fz="xs" c="dimmed">
          {fillTemplate(t('flow.skill.calendar.emitFailFlag.hint'), { flag: `{{${step.outputKey}.isFailed}}` })}
        </Text>
      )}

      <Text fz="xs" c="dimmed">
        {fillTemplate(t('flow.skill.calendar.outputHint'), {
          list: `{{${step.outputKey}}}`,
          text: `{{${step.outputKey}.text}}`,
          count: `{{${step.outputKey}.count}}`,
        })}
      </Text>
    </Stack>
  );
};
