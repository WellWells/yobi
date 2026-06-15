import type { TriggerConfig } from './types';

const DEFAULT_INTERVAL_VALUE = 1;
const DEFAULT_INTERVAL_UNIT: 'minutes' | 'hours' = 'hours';
const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5] as const;
const DEFAULT_SCHEDULE_HOUR = 9;
const DEFAULT_SCHEDULE_MINUTE = 0;
const DEFAULT_REPEAT_EVERY_VALUE = 1;
const DEFAULT_REPEAT_EVERY_UNIT: 'minutes' | 'hours' = 'hours';
const DEFAULT_END_HOUR = 18;
const DEFAULT_END_MINUTE = 0;

function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function normalizeWeekdays(weekdays: number[] | undefined): number[] {
  if (!Array.isArray(weekdays)) return [...DEFAULT_WEEKDAYS];
  const normalized = Array.from(
    new Set(
      weekdays
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
        .map((day) => Math.trunc(day)),
    ),
  ).sort((a, b) => a - b);
  return normalized.length > 0 ? normalized : [...DEFAULT_WEEKDAYS];
}

function resolveScheduleMode(trigger: TriggerConfig): 'interval' | 'weekly' {
  if (trigger.scheduleMode) return trigger.scheduleMode;
  if (trigger.intervalValue !== undefined || trigger.intervalUnit !== undefined) return 'interval';
  return 'weekly';
}

export function shouldNormalizeCronTrigger(trigger: TriggerConfig): boolean {
  if (trigger.type !== 'cron') return false;
  return Boolean(
    trigger.scheduleMode !== undefined
    || trigger.intervalValue !== undefined
    || trigger.intervalUnit !== undefined
    || trigger.weekdays !== undefined
    || trigger.scheduleHour !== undefined
    || trigger.scheduleMinute !== undefined
    || trigger.repeatWithinDay !== undefined
    || trigger.repeatEveryValue !== undefined
    || trigger.repeatEveryUnit !== undefined
    || trigger.endHour !== undefined
    || trigger.endMinute !== undefined
    || !trigger.cronExpression,
  );
}

export function buildFlowCronExpression(trigger: TriggerConfig): string {
  const scheduleMode = resolveScheduleMode(trigger);
  if (scheduleMode === 'interval') {
    const intervalUnit = trigger.intervalUnit ?? DEFAULT_INTERVAL_UNIT;
    const maxInterval = intervalUnit === 'hours' ? 24 : 59;
    const intervalValue = clampInteger(trigger.intervalValue, 1, maxInterval, DEFAULT_INTERVAL_VALUE);
    if (intervalUnit === 'hours') {
      return intervalValue === 1 ? '0 * * * *' : `0 */${intervalValue} * * *`;
    }
    return intervalValue === 1 ? '* * * * *' : `*/${intervalValue} * * * *`;
  }

  const minute = clampInteger(trigger.scheduleMinute, 0, 59, DEFAULT_SCHEDULE_MINUTE);
  const hour = clampInteger(trigger.scheduleHour, 0, 23, DEFAULT_SCHEDULE_HOUR);
  const weekdays = normalizeWeekdays(trigger.weekdays);
  const repeatWithinDay = Boolean(trigger.repeatWithinDay);
  if (repeatWithinDay) return '* * * * *';
  return `${minute} ${hour} * * ${weekdays.join(',')}`;
}

const WEEKDAY_NAME_TO_NUM: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

function resolveWeekdayValue(token: string): number | null {
  if (/^\d+$/.test(token)) {
    const n = Number(token);
    if (n < 0 || n > 7) return null;
    return n === 7 ? 0 : n;
  }
  const named = WEEKDAY_NAME_TO_NUM[token];
  return named === undefined ? null : named;
}

function expandWeekdayToken(token: string): number[] | null {
  const range = /^([a-z0-9]+)-([a-z0-9]+)$/.exec(token);
  if (range) {
    const start = resolveWeekdayValue(range[1]);
    const end = resolveWeekdayValue(range[2]);
    if (start === null || end === null) return null;
    const days: number[] = [];
    let day = start;
    for (let i = 0; i < 7; i++) {
      days.push(day);
      if (day === end) return days;
      day = (day + 1) % 7;
    }
    return days;
  }
  const single = resolveWeekdayValue(token);
  return single === null ? null : [single];
}

function parseCronWeekdays(field: string): number[] | null {
  if (field === '*') return [0, 1, 2, 3, 4, 5, 6];
  const days = new Set<number>();
  for (const token of field.split(',')) {
    const expanded = expandWeekdayToken(token.trim().toLowerCase());
    if (!expanded) return null;
    for (const day of expanded) days.add(day);
  }
  const sorted = Array.from(days).sort((a, b) => a - b);
  return sorted.length > 0 ? sorted : null;
}

export function parseCronToScheduleFields(cronExpression: string): Partial<TriggerConfig> | null {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  if (dayOfMonth !== '*' || month !== '*') return null;

  if (dayOfWeek === '*') {
    if (hour === '*') {
      if (minute === '*') return { scheduleMode: 'interval', intervalUnit: 'minutes', intervalValue: 1 };
      const stepMinute = /^\*\/(\d+)$/.exec(minute);
      if (stepMinute) {
        const n = Number(stepMinute[1]);
        return n >= 1 && n <= 59 ? { scheduleMode: 'interval', intervalUnit: 'minutes', intervalValue: n } : null;
      }
      if (minute === '0') return { scheduleMode: 'interval', intervalUnit: 'hours', intervalValue: 1 };
      return null;
    }
    if (minute === '0') {
      const stepHour = /^\*\/(\d+)$/.exec(hour);
      if (stepHour) {
        const n = Number(stepHour[1]);
        return n >= 1 && n <= 24 ? { scheduleMode: 'interval', intervalUnit: 'hours', intervalValue: n } : null;
      }
    }
  }

  if (/^\d+$/.test(minute) && /^\d+$/.test(hour)) {
    const m = Number(minute);
    const h = Number(hour);
    if (m > 59 || h > 23) return null;
    const weekdays = parseCronWeekdays(dayOfWeek);
    return weekdays ? { scheduleMode: 'weekly', scheduleHour: h, scheduleMinute: m, weekdays } : null;
  }
  return null;
}

export function normalizeCronTrigger(trigger: TriggerConfig): TriggerConfig {
  if (trigger.type !== 'cron') return trigger;

  const scheduleMode = resolveScheduleMode(trigger);
  const normalized: TriggerConfig = { ...trigger, scheduleMode };

  if (scheduleMode === 'interval') {
    const intervalUnit = trigger.intervalUnit ?? DEFAULT_INTERVAL_UNIT;
    const maxInterval = intervalUnit === 'hours' ? 24 : 59;
    normalized.intervalUnit = intervalUnit;
    normalized.intervalValue = clampInteger(trigger.intervalValue, 1, maxInterval, DEFAULT_INTERVAL_VALUE);
  } else {
    normalized.weekdays = normalizeWeekdays(trigger.weekdays);
    normalized.scheduleHour = clampInteger(trigger.scheduleHour, 0, 23, DEFAULT_SCHEDULE_HOUR);
    normalized.scheduleMinute = clampInteger(trigger.scheduleMinute, 0, 59, DEFAULT_SCHEDULE_MINUTE);
    normalized.repeatWithinDay = Boolean(trigger.repeatWithinDay);
    normalized.repeatEveryUnit = trigger.repeatEveryUnit ?? DEFAULT_REPEAT_EVERY_UNIT;
    normalized.repeatEveryValue = clampInteger(
      trigger.repeatEveryValue,
      1,
      normalized.repeatEveryUnit === 'hours' ? 24 : 59,
      DEFAULT_REPEAT_EVERY_VALUE,
    );
    normalized.endHour = clampInteger(trigger.endHour, 0, 23, DEFAULT_END_HOUR);
    normalized.endMinute = clampInteger(trigger.endMinute, 0, 59, DEFAULT_END_MINUTE);
  }

  normalized.cronExpression = buildFlowCronExpression(normalized);
  return normalized;
}

export function shouldExecuteCronTriggerNow(trigger: TriggerConfig, now: Date = new Date()): boolean {
  if (trigger.type !== 'cron') return false;
  if (!trigger.repeatWithinDay) return true;

  const weekdays = normalizeWeekdays(trigger.weekdays);
  if (!weekdays.includes(now.getDay())) return false;

  const startHour = clampInteger(trigger.scheduleHour, 0, 23, DEFAULT_SCHEDULE_HOUR);
  const startMinute = clampInteger(trigger.scheduleMinute, 0, 59, DEFAULT_SCHEDULE_MINUTE);
  const endHour = clampInteger(trigger.endHour, 0, 23, DEFAULT_END_HOUR);
  const endMinute = clampInteger(trigger.endMinute, 0, 59, DEFAULT_END_MINUTE);
  const nowMinuteOfDay = now.getHours() * 60 + now.getMinutes();
  const startMinuteOfDay = startHour * 60 + startMinute;
  const endMinuteOfDay = endHour * 60 + endMinute;

  if (endMinuteOfDay < startMinuteOfDay) return false;
  if (nowMinuteOfDay < startMinuteOfDay || nowMinuteOfDay > endMinuteOfDay) return false;

  const unit = trigger.repeatEveryUnit ?? DEFAULT_REPEAT_EVERY_UNIT;
  const interval = clampInteger(
    trigger.repeatEveryValue,
    1,
    unit === 'hours' ? 24 : 59,
    DEFAULT_REPEAT_EVERY_VALUE,
  ) * (unit === 'hours' ? 60 : 1);

  return (nowMinuteOfDay - startMinuteOfDay) % interval === 0;
}
