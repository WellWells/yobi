import React, { useEffect, useMemo, useState } from 'react';
import { Group, Input, Stack, Text } from '@mantine/core';
import { Settings } from 'lucide-react';
import { AppButton } from '../../../components/AppButton';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { AppSegmentedControl } from '../../../components/AppSegmentedControl';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { calendarApi } from '../../../api/electronApi';
import { useAppStore } from '../../../store/appStore';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import {
  CALENDAR_STEP_RANGES, DEFAULT_CALENDAR_MAX_EVENTS, MAX_CALENDAR_MAX_EVENTS, calendarNameKey,
} from '../../../../../shared/calendars';
import type { CalendarStepRange, CalendarSummary } from '../../../../../shared/calendars';
import type { SkillConfigProps } from './types';

/** The option that stores a blank field: every calendar, merged. */
const ALL_CALENDARS = '*all';

/** A range the run does not know (a variable, an AI's word) runs as today, so it shows as that. */
export function calendarRange(raw: string | undefined): CalendarStepRange {
  return CALENDAR_STEP_RANGES.find((range) => range === raw) ?? 'today';
}

/**
 * Which calendar the picker shows for the stored value: a name that matches shows as that
 * calendar; blank is "all" when there are several and the only one when there is one, since that
 * is what the run reads.
 */
export function shownCalendar(calendars: readonly CalendarSummary[], value: string): string {
  const named = calendars.find((calendar) => calendarNameKey(calendar.name) === calendarNameKey(value))?.id;
  if (named) return named;
  if (value) return value;
  if (calendars.length > 1) return ALL_CALENDARS;
  return calendars[0]?.id ?? '';
}

/**
 * The calendar step: which calendar (stored by id; the address and sign-in stay in Settings) or
 * all of them, which days, how many events. A name the AI wrote, or an id from another machine,
 * stays selectable as itself until the person picks one of theirs.
 */
export const CalendarConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const currentView = useAppStore((s) => s.currentView);
  const openSettingsCategory = useAppStore((s) => s.openSettingsCategory);
  const [calendars, setCalendars] = useState<CalendarSummary[] | null>(null);

  useEffect(() => {
    if (currentView !== 'flow') return;
    void calendarApi.list().then(setCalendars);
  }, [currentView]);

  const list = useMemo(() => calendars ?? [], [calendars]);
  const value = (step.config.calendar ?? '').trim();
  const options = useMemo(() => {
    const known = list.map((calendar) => ({
      value: calendar.id,
      label: calendar.account ? fillTemplate(t('flow.skill.calendar.calendar.ofAccount'), { name: calendar.name, account: calendar.account }) : calendar.name,
    }));
    const all = list.length > 1 ? [{ value: ALL_CALENDARS, label: t('flow.skill.calendar.calendar.all') }] : [];
    const matches = list.some((calendar) => calendar.id === value || calendarNameKey(calendar.name) === calendarNameKey(value));
    return value && !matches ? [...all, ...known, { value, label: value }] : [...all, ...known];
  }, [list, value, t]);
  const range = calendarRange(step.config.range);
  const none = calendars !== null && calendars.length === 0 && !value;

  return (
    <Stack gap="xs">
      {none ? (
        <Group gap={8} wrap="nowrap" align="center">
          <Text fz="sm" c="var(--mantine-color-warning)" style={{ flex: 1 }}>{t('flow.skill.calendar.calendar.none')}</Text>
          <AppButton
            variant="default"
            size="compact-xs"
            leftSection={<Settings size={12} />}
            onClick={() => openSettingsCategory('connectors')}
            style={{ flexShrink: 0 }}
          >
            {t('flow.setup.openSettings')}
          </AppButton>
        </Group>
      ) : (
        <Stack gap={4}>
          <SelectDropdown
            label={t('flow.skill.calendar.calendar')}
            placeholder={t('flow.skill.calendar.calendar.placeholder')}
            options={options}
            value={shownCalendar(list, value) || null}
            onChange={(next) => onChange({ ...step.config, calendar: next === ALL_CALENDARS ? '' : next })}
            size="sm"
          />
          <Text fz="xs" c="var(--text-muted)">{t('flow.skill.calendar.calendar.hint')}</Text>
        </Stack>
      )}

      <Group gap="xs" align="flex-end" wrap="wrap">
        <Input.Wrapper label={t('flow.skill.calendar.range')}>
          <AppSegmentedControl
            value={range}
            onChange={(next) => onChange({ ...step.config, range: next })}
            options={CALENDAR_STEP_RANGES.map((item) => ({ value: item, label: t(`flow.skill.calendar.range.${item}`) }))}
            fullWidth={false}
            size="sm"
          />
        </Input.Wrapper>
        {range === 'days' && (
          <AppNumberInput
            label={t('flow.skill.calendar.days')}
            value={step.config.days ?? '7'}
            onChange={(v) => onChange({ ...step.config, days: v === '' ? '' : String(v) })}
            size="sm"
            w={120}
            min={1}
            max={31}
            step={1}
            allowDecimal={false}
            allowNegative={false}
          />
        )}
      </Group>
      <AppNumberInput
        label={t('flow.skill.calendar.maxEvents')}
        value={step.config.maxEvents ?? String(DEFAULT_CALENDAR_MAX_EVENTS)}
        onChange={(v) => onChange({ ...step.config, maxEvents: v === '' ? '' : String(v) })}
        size="sm"
        w={160}
        min={1}
        max={MAX_CALENDAR_MAX_EVENTS}
        step={1}
        allowDecimal={false}
        allowNegative={false}
      />

      <ToggleSwitch
        label={t('flow.skill.calendar.emitFailFlag')}
        size="sm"
        checked={step.config.emitFailFlag === 'true'}
        onChange={(e) => onChange({ ...step.config, emitFailFlag: e.currentTarget.checked ? 'true' : 'false' })}
      />
      {step.config.emitFailFlag === 'true' && (
        <Text fz="xs" c="var(--text-muted)">
          {fillTemplate(t('flow.skill.calendar.emitFailFlag.hint'), { flag: `{{${step.outputKey}.isFailed}}` })}
        </Text>
      )}

      <Text fz="xs" c="var(--text-muted)">
        {fillTemplate(t('flow.skill.calendar.outputHint'), {
          list: `{{${step.outputKey}}}`,
          text: `{{${step.outputKey}.text}}`,
          count: `{{${step.outputKey}.count}}`,
        })}
      </Text>
    </Stack>
  );
};
