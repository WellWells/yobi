import type { TriggerConfig } from './types';
import {
  INTERVAL_HOUR_STEPS,
  INTERVAL_MINUTE_STEPS,
  LAST_DAY_OF_MONTH,
  daysInMonth,
} from './flowScheduleCore';

const WEEKDAY_NAME_TO_NUM: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

const MONTH_NAME_TO_NUM: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function plainInteger(field: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(field)) return null;
  const value = Number(field);
  return value >= min && value <= max ? value : null;
}

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

/** Day-of-month list, where `L` is the month-end sentinel. Rejects `L-n`, which the editor cannot show. */
function parseCronMonthDays(field: string): number[] | null {
  const days = new Set<number>();
  for (const raw of field.split(',')) {
    const token = raw.trim().toLowerCase();
    if (token === 'l') {
      days.add(LAST_DAY_OF_MONTH);
      continue;
    }
    const range = /^(\d+)-(\d+)$/.exec(token);
    if (range) {
      const start = plainInteger(range[1], 1, 31);
      const end = plainInteger(range[2], 1, 31);
      if (start === null || end === null || end < start) return null;
      for (let day = start; day <= end; day++) days.add(day);
      continue;
    }
    const single = plainInteger(token, 1, 31);
    if (single === null) return null;
    days.add(single);
  }
  return days.size > 0 ? Array.from(days) : null;
}

function parseCronMonth(field: string): number | null {
  const numeric = plainInteger(field, 1, 12);
  if (numeric !== null) return numeric;
  const named = MONTH_NAME_TO_NUM[field.trim().toLowerCase()];
  return named ?? null;
}

function parseIntervalFields(
  minuteField: string,
  hourField: string,
): Partial<TriggerConfig> | null {
  if (hourField === '*') {
    if (minuteField === '*') {
      return { scheduleMode: 'interval', intervalUnit: 'minutes', intervalValue: 1 };
    }
    const step = /^\*\/(\d+)$/.exec(minuteField);
    if (step) {
      const value = Number(step[1]);
      return (INTERVAL_MINUTE_STEPS as readonly number[]).includes(value)
        ? { scheduleMode: 'interval', intervalUnit: 'minutes', intervalValue: value }
        : null;
    }
    const offset = plainInteger(minuteField, 0, 59);
    if (offset === null) return null;
    const fields: Partial<TriggerConfig> = { scheduleMode: 'interval', intervalUnit: 'hours', intervalValue: 1 };
    if (offset > 0) fields.intervalMinuteOffset = offset;
    return fields;
  }

  const step = /^\*\/(\d+)$/.exec(hourField);
  if (!step) return null;
  const value = Number(step[1]);
  const offset = plainInteger(minuteField, 0, 59);
  if (offset === null || !(INTERVAL_HOUR_STEPS as readonly number[]).includes(value)) return null;
  const fields: Partial<TriggerConfig> = { scheduleMode: 'interval', intervalUnit: 'hours', intervalValue: value };
  if (offset > 0) fields.intervalMinuteOffset = offset;
  return fields;
}

export function parseCronToScheduleFields(cronExpression: string): Partial<TriggerConfig> | null {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minuteField, hourField, dayOfMonthField, monthField, dayOfWeekField] = parts;

  const minute = plainInteger(minuteField, 0, 59);
  const hour = plainInteger(hourField, 0, 23);

  if (dayOfMonthField !== '*') {
    if (dayOfWeekField !== '*' || minute === null || hour === null) return null;

    if (monthField === '*') {
      const monthDays = parseCronMonthDays(dayOfMonthField);
      return monthDays
        ? { scheduleMode: 'monthly', scheduleHour: hour, scheduleMinute: minute, monthDays }
        : null;
    }

    const month = parseCronMonth(monthField);
    const day = plainInteger(dayOfMonthField, 1, 31);
    if (month === null || day === null || day > daysInMonth(month)) return null;
    return {
      scheduleMode: 'yearly', scheduleHour: hour, scheduleMinute: minute, scheduleMonth: month, scheduleDay: day,
    };
  }

  if (monthField !== '*') return null;

  if (dayOfWeekField === '*') {
    if (hour !== null && minute !== null) {
      return { scheduleMode: 'daily', scheduleHour: hour, scheduleMinute: minute };
    }
    return parseIntervalFields(minuteField, hourField);
  }

  if (minute === null || hour === null) return null;
  const weekdays = parseCronWeekdays(dayOfWeekField);
  return weekdays
    ? { scheduleMode: 'weekly', scheduleHour: hour, scheduleMinute: minute, weekdays }
    : null;
}
