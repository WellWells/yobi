import type { ScheduleMode, TriggerConfig } from './types';

/**
 * Only steps that divide their unit evenly are offered. A non-divisor ("every 7 minutes") cannot be
 * written as a single cron expression that keeps an even spacing: a step of 7 restarts at the top of every hour,
 * so the last gap of each hour is short. Offering it would be lying about what runs.
 */
export const INTERVAL_MINUTE_STEPS = [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30] as const;
export const INTERVAL_HOUR_STEPS = [1, 2, 3, 4, 6, 8, 12, 24] as const;

/** Sentinel inside `monthDays`: whichever day ends the month (cron `L`). */
export const LAST_DAY_OF_MONTH = -1;

export const SCHEDULE_MODES: readonly ScheduleMode[] =
  ['interval', 'daily', 'weekly', 'monthly', 'yearly', 'once'] as const;

export const SCHEDULE_DEFAULTS = {
  intervalValue: 1,
  intervalUnit: 'hours' as const,
  intervalMinuteOffset: 0,
  weekdays: [1, 2, 3, 4, 5] as readonly number[],
  hour: 9,
  minute: 0,
  repeatEveryValue: 1,
  repeatEveryUnit: 'hours' as const,
  endHour: 18,
  endMinute: 0,
  monthDays: [1] as readonly number[],
  month: 1,
  day: 1,
} as const;

export function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** Nearest allowed step; ties go to the shorter interval so a flow never runs less often than asked. */
export function snapToStep(value: number | undefined, steps: readonly number[], fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  const target = Math.trunc(value);
  let best = steps[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const step of steps) {
    const distance = Math.abs(step - target);
    if (distance < bestDistance) {
      best = step;
      bestDistance = distance;
    }
  }
  return best;
}

export function normalizeWeekdays(weekdays: number[] | undefined): number[] {
  if (!Array.isArray(weekdays)) return [...SCHEDULE_DEFAULTS.weekdays];
  const normalized = Array.from(
    new Set(
      weekdays
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
        .map((day) => Math.trunc(day)),
    ),
  ).sort((a, b) => a - b);
  return normalized.length > 0 ? normalized : [...SCHEDULE_DEFAULTS.weekdays];
}

/** 1-31 plus LAST_DAY_OF_MONTH, sorted ascending with the month-end sentinel last. */
export function normalizeMonthDays(monthDays: number[] | undefined): number[] {
  if (!Array.isArray(monthDays)) return [...SCHEDULE_DEFAULTS.monthDays];
  const normalized = Array.from(
    new Set(
      monthDays
        .filter((day) => Number.isInteger(day) && ((day >= 1 && day <= 31) || day === LAST_DAY_OF_MONTH))
        .map((day) => Math.trunc(day)),
    ),
  ).sort((a, b) => {
    if (a === LAST_DAY_OF_MONTH) return 1;
    if (b === LAST_DAY_OF_MONTH) return -1;
    return a - b;
  });
  return normalized.length > 0 ? normalized : [...SCHEDULE_DEFAULTS.monthDays];
}

export function daysInMonth(month: number, year?: number): number {
  if (month === 2) return year === undefined ? 29 : new Date(year, 2, 0).getDate();
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function isScheduleMode(value: unknown): value is ScheduleMode {
  return typeof value === 'string' && (SCHEDULE_MODES as readonly string[]).includes(value);
}

export function resolveScheduleMode(trigger: TriggerConfig): ScheduleMode {
  if (isScheduleMode(trigger.scheduleMode)) return trigger.scheduleMode;
  if (trigger.intervalValue !== undefined || trigger.intervalUnit !== undefined) return 'interval';
  return 'weekly';
}

/**
 * False only for a cron expression the editor never produced (an imported or generated one with no
 * structured fields). Those must be shown and previewed verbatim, never re-derived from defaults.
 */
export function hasStructuredSchedule(trigger: TriggerConfig): boolean {
  return isScheduleMode(trigger.scheduleMode)
    || trigger.intervalValue !== undefined
    || trigger.intervalUnit !== undefined
    || trigger.weekdays !== undefined
    || trigger.scheduleHour !== undefined
    || trigger.scheduleMinute !== undefined
    || trigger.monthDays !== undefined
    || trigger.scheduleMonth !== undefined
    || trigger.scheduleDay !== undefined
    || trigger.onceDate !== undefined
    || !trigger.cronExpression;
}

export interface OnceDateParts {
  year: number;
  month: number;
  day: number;
}

export function parseOnceDate(value: string | undefined): OnceDateParts | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(month, year)) return null;
  return { year, month, day };
}

export function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** True once the one-shot moment has passed — the registry must not arm it for the same day next year. */
export function isOnceExpired(trigger: TriggerConfig, now: Date = new Date()): boolean {
  const parts = parseOnceDate(trigger.onceDate);
  if (!parts) return true;
  const hour = clampInteger(trigger.scheduleHour, 0, 23, SCHEDULE_DEFAULTS.hour);
  const minute = clampInteger(trigger.scheduleMinute, 0, 59, SCHEDULE_DEFAULTS.minute);
  return new Date(parts.year, parts.month - 1, parts.day, hour, minute, 0, 0).getTime() <= now.getTime();
}
