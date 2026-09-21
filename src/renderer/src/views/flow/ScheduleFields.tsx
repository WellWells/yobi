import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Chip, Collapse, Group, Stack, Text } from '@mantine/core';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ScheduleMode, TriggerConfig } from '../../../../shared/types';
import {
  INTERVAL_HOUR_STEPS,
  INTERVAL_MINUTE_STEPS,
  SCHEDULE_DEFAULTS,
  SCHEDULE_MODES,
  daysInMonth,
  normalizeMonthDays,
  parseCronToScheduleFields,
  resolveScheduleMode,
  toIsoDate,
} from '../../../../shared/flowSchedule';
import { AppNumberInput } from '../../components/AppNumberInput';
import { AppTextInput } from '../../components/AppTextInput';
import { SelectDropdown } from '../../components/SelectDropdown';
import { ToggleSwitch } from '../../components/ToggleSwitch';
import { CalendarGrid, MonthDayGrid, MonthGrid } from './DateGrid';
import { SchedulePreviewPanel } from './SchedulePreviewPanel';
import { TimeField } from './TimeField';

const DAY_OPTIONS = [
  { value: '0', key: 'sun' },
  { value: '1', key: 'mon' },
  { value: '2', key: 'tue' },
  { value: '3', key: 'wed' },
  { value: '4', key: 'thu' },
  { value: '5', key: 'fri' },
  { value: '6', key: 'sat' },
] as const;

/** Catch-up is meaningless for a schedule that comes round again within the hour. */
const CATCH_UP_MODES: readonly ScheduleMode[] = ['daily', 'weekly', 'monthly', 'yearly', 'once'];

export interface ScheduleFieldsProps {
  value: TriggerConfig;
  patch: (next: Partial<TriggerConfig>) => void;
  t: (key: string) => string;
}

const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Text fz="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: '0.05em' }}>
    {children}
  </Text>
);

export const ScheduleFields: React.FC<ScheduleFieldsProps> = ({ value, patch, t }) => {
  const mode = resolveScheduleMode(value);
  const hour = value.scheduleHour ?? SCHEDULE_DEFAULTS.hour;
  const minute = value.scheduleMinute ?? SCHEDULE_DEFAULTS.minute;
  const weekdays = value.weekdays ?? [...SCHEDULE_DEFAULTS.weekdays];
  const monthDays = normalizeMonthDays(value.monthDays);
  const scheduleMonth = value.scheduleMonth ?? SCHEDULE_DEFAULTS.month;
  const scheduleDay = value.scheduleDay ?? SCHEDULE_DEFAULTS.day;
  const intervalUnit = value.intervalUnit ?? SCHEDULE_DEFAULTS.intervalUnit;
  const repeatUnit = value.repeatEveryUnit ?? SCHEDULE_DEFAULTS.repeatEveryUnit;

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [cronDraft, setCronDraft] = useState<string | null>(null);
  const [cronError, setCronError] = useState(false);

  // A rejected draft stays on screen until the schedule itself moves on.
  useEffect(() => {
    setCronDraft(null);
    setCronError(false);
  }, [value.cronExpression]);

  const modeOptions = useMemo(
    () => SCHEDULE_MODES.map((m) => ({ value: m, label: t(`flow.trigger.schedule.mode.${m}`) })),
    [t],
  );
  const unitOptions = useMemo(() => [
    { value: 'minutes', label: t('flow.trigger.schedule.minutes') },
    { value: 'hours', label: t('flow.trigger.schedule.hours') },
  ], [t]);

  const stepOptions = useCallback((unit: 'minutes' | 'hours') =>
    (unit === 'hours' ? INTERVAL_HOUR_STEPS : INTERVAL_MINUTE_STEPS)
      .map((step) => ({ value: String(step), label: String(step) })), []);

  const toggleMonthDay = useCallback((day: number) => {
    const next = monthDays.includes(day) ? monthDays.filter((d) => d !== day) : [...monthDays, day];
    patch({ monthDays: next.length > 0 ? next : [day] });
  }, [monthDays, patch]);

  const applyCron = useCallback((text: string) => {
    const fields = parseCronToScheduleFields(text);
    if (!fields) {
      setCronError(true);
      return;
    }
    setCronError(false);
    setCronDraft(null);
    patch(fields);
  }, [patch]);

  const timeRow = (
    <>
      <Text fz="sm" fw={600}>{t('flow.trigger.schedule.at')}</Text>
      <TimeField
        hour={hour}
        minute={minute}
        label={t('flow.trigger.schedule.startTime')}
        onChange={(h, m) => patch({ scheduleHour: h, scheduleMinute: m })}
      />
    </>
  );

  return (
    <Stack gap="sm">
      <Group gap="xs" align="center" wrap="wrap">
        <SelectDropdown
          aria-label={t('flow.trigger.cron')}
          options={modeOptions}
          value={mode}
          onChange={(v) => patch({ scheduleMode: v as ScheduleMode })}
          size="sm"
          w={120}
        />

        {mode === 'interval' ? (
          <>
            <Text fz="sm" fw={600}>{t('flow.trigger.schedule.runEvery')}</Text>
            <SelectDropdown
              aria-label={t('flow.trigger.schedule.runEvery')}
              options={stepOptions(intervalUnit)}
              value={String(value.intervalValue ?? SCHEDULE_DEFAULTS.intervalValue)}
              onChange={(v) => patch({ intervalValue: Number(v) })}
              size="sm"
              w={80}
              withCheckIcon={false}
            />
            <SelectDropdown
              options={unitOptions}
              value={intervalUnit}
              onChange={(v) => patch({ intervalUnit: v as 'minutes' | 'hours' })}
              size="sm"
              w={110}
            />
            {intervalUnit === 'hours' && (
              <>
                <Text fz="sm" fw={600}>{t('flow.trigger.schedule.atMinute')}</Text>
                <AppNumberInput
                  aria-label={t('flow.trigger.schedule.atMinute')}
                  min={0}
                  max={59}
                  step={1}
                  allowDecimal={false}
                  allowNegative={false}
                  value={value.intervalMinuteOffset ?? SCHEDULE_DEFAULTS.intervalMinuteOffset}
                  onChange={(v) => patch({ intervalMinuteOffset: typeof v === 'number' ? v : 0 })}
                  size="sm"
                  w={80}
                />
              </>
            )}
          </>
        ) : timeRow}
      </Group>

      {mode === 'weekly' && (
        <Stack gap="xs">
          <FieldLabel>{t('flow.trigger.schedule.days')}</FieldLabel>
          <Chip.Group
            multiple
            value={weekdays.map(String)}
            onChange={(vals) => patch({ weekdays: vals.map(Number) })}
          >
            <Group gap={4} wrap="wrap">
              {DAY_OPTIONS.map((d) => (
                <Chip key={d.value} value={d.value} size="xs" variant="light">
                  {t(`flow.trigger.schedule.day.${d.key}`)}
                </Chip>
              ))}
            </Group>
          </Chip.Group>

          <ToggleSwitch
            label={t('flow.trigger.schedule.repeatWithinDay')}
            size="sm"
            checked={value.repeatWithinDay ?? false}
            onChange={(e) => patch({ repeatWithinDay: e.currentTarget.checked })}
          />

          {value.repeatWithinDay && (
            <Group gap="xs" align="center" wrap="wrap">
              <Text fz="sm" fw={600}>{t('flow.trigger.schedule.repeatEvery')}</Text>
              <SelectDropdown
                aria-label={t('flow.trigger.schedule.repeatEvery')}
                options={stepOptions(repeatUnit)}
                value={String(value.repeatEveryValue ?? SCHEDULE_DEFAULTS.repeatEveryValue)}
                onChange={(v) => patch({ repeatEveryValue: Number(v) })}
                size="sm"
                w={80}
                withCheckIcon={false}
              />
              <SelectDropdown
                options={unitOptions}
                value={repeatUnit}
                onChange={(v) => patch({ repeatEveryUnit: v as 'minutes' | 'hours' })}
                size="sm"
                w={110}
              />
              <Text fz="sm" fw={600}>{t('flow.trigger.schedule.until')}</Text>
              <TimeField
                hour={value.endHour ?? SCHEDULE_DEFAULTS.endHour}
                minute={value.endMinute ?? SCHEDULE_DEFAULTS.endMinute}
                label={t('flow.trigger.schedule.endTime')}
                onChange={(h, m) => patch({ endHour: h, endMinute: m })}
              />
            </Group>
          )}
        </Stack>
      )}

      {mode === 'monthly' && (
        <Stack gap="xs">
          <FieldLabel>{t('flow.trigger.schedule.monthDays')}</FieldLabel>
          <MonthDayGrid selected={monthDays} onToggle={toggleMonthDay} t={t} showLastDay />
        </Stack>
      )}

      {mode === 'yearly' && (
        <Stack gap="xs">
          <FieldLabel>{t('flow.trigger.schedule.yearDate')}</FieldLabel>
          <MonthGrid
            value={scheduleMonth}
            onChange={(month) => patch({
              scheduleMonth: month,
              scheduleDay: Math.min(scheduleDay, daysInMonth(month)),
            })}
            t={t}
          />
          <MonthDayGrid
            selected={[scheduleDay]}
            onToggle={(day) => patch({ scheduleDay: day })}
            t={t}
            maxDay={daysInMonth(scheduleMonth)}
          />
        </Stack>
      )}

      {mode === 'once' && (
        <Stack gap="xs">
          <FieldLabel>{t('flow.trigger.schedule.onceDate')}</FieldLabel>
          <CalendarGrid
            value={value.onceDate ?? toIsoDate(new Date())}
            onChange={(iso) => patch({ onceDate: iso })}
            t={t}
          />
        </Stack>
      )}

      {CATCH_UP_MODES.includes(mode) && (
        <Stack gap={2}>
          <ToggleSwitch
            label={t('flow.trigger.schedule.catchUp')}
            size="sm"
            checked={value.catchUpMissed ?? false}
            onChange={(e) => patch({ catchUpMissed: e.currentTarget.checked })}
          />
          <Text fz="xs" c="dimmed">{t('flow.trigger.schedule.catchUp.hint')}</Text>
        </Stack>
      )}

      <SchedulePreviewPanel trigger={value} t={t} />

      <Box>
        <Group
          gap={4}
          align="center"
          style={{ cursor: 'pointer' }}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          {advancedOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <Text fz="xs" c="dimmed">{t('flow.trigger.schedule.advanced')}</Text>
        </Group>
        <Collapse expanded={advancedOpen}>
          <Stack gap={4} pt={6}>
            <AppTextInput
              aria-label={t('flow.trigger.schedule.advanced')}
              tone="tertiary"
              mono
              size="sm"
              value={cronDraft ?? value.cronExpression ?? ''}
              onChange={(e) => { setCronDraft(e.currentTarget.value); setCronError(false); }}
              onBlur={(e) => applyCron(e.currentTarget.value)}
            />
            {cronError && (
              <Text fz="xs" c="orange">{t('flow.trigger.schedule.advanced.invalid')}</Text>
            )}
          </Stack>
        </Collapse>
      </Box>
    </Stack>
  );
};
