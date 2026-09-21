import type { TriggerConfig } from './types';
import {
  LAST_DAY_OF_MONTH,
  SCHEDULE_DEFAULTS,
  clampInteger,
  hasStructuredSchedule,
  isOnceExpired,
  normalizeMonthDays,
  normalizeWeekdays,
  parseOnceDate,
  resolveScheduleMode,
} from './flowScheduleCore';

export type TranslateFn = (key: string) => string;

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** The renderer's `t` has no interpolation, so placeholders are filled here. */
function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

export function formatTimeOfDay(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Takes what a person actually types. The colon is optional and any of a full stop, a full-width
 * colon or a space stands in for it, so "0900", "900", "9", "9.30" and "9 30" all land. Returning
 * null is reserved for input that cannot be a time at all.
 */
export function parseTimeOfDay(text: string): { hour: number; minute: number } | null {
  const compact = text
    .trim()
    .replace(/\uFF1A/g, ':')
    .replace(/\uFF0E/g, ':')
    .replace(/\./g, ':')
    .replace(/\s+/g, ':');

  const inRange = (hour: number, minute: number): { hour: number; minute: number } | null =>
    (hour <= 23 && minute <= 59 ? { hour, minute } : null);

  const separated = /^(\d{1,2}):(\d{1,2})$/.exec(compact);
  if (separated) return inRange(Number(separated[1]), Number(separated[2]));

  if (!/^\d+$/.test(compact)) return null;
  if (compact.length <= 2) return inRange(Number(compact), 0);
  if (compact.length === 3) return inRange(Number(compact.slice(0, 1)), Number(compact.slice(1)));
  if (compact.length === 4) return inRange(Number(compact.slice(0, 2)), Number(compact.slice(2)));
  return null;
}

export function weekdayLabel(t: TranslateFn, day: number): string {
  return t(`flow.trigger.schedule.day.${WEEKDAY_KEYS[day] ?? 'sun'}`);
}

function joinList(t: TranslateFn, items: string[]): string {
  return items.join(t('flow.trigger.schedule.listSeparator'));
}

function repeatLabel(t: TranslateFn, value: number, unit: 'minutes' | 'hours'): string {
  const key = unit === 'hours' ? 'flow.trigger.schedule.repeatHours' : 'flow.trigger.schedule.repeatMinutes';
  return fill(t(key), { value });
}

function monthDayLabel(t: TranslateFn, day: number): string {
  if (day === LAST_DAY_OF_MONTH) return t('flow.trigger.schedule.lastDay');
  return fill(t('flow.trigger.schedule.dayOfMonth'), { value: day });
}

function describeInterval(trigger: TriggerConfig, t: TranslateFn): string {
  const value = trigger.intervalValue ?? SCHEDULE_DEFAULTS.intervalValue;
  if ((trigger.intervalUnit ?? SCHEDULE_DEFAULTS.intervalUnit) === 'minutes') {
    return fill(t('flow.trigger.schedule.summary.intervalMinutes'), { value });
  }
  const offset = clampInteger(trigger.intervalMinuteOffset, 0, 59, SCHEDULE_DEFAULTS.intervalMinuteOffset);
  if (offset === 0) return fill(t('flow.trigger.schedule.summary.intervalHours'), { value });
  return fill(t('flow.trigger.schedule.summary.intervalHoursAt'), { value, minute: offset });
}

function describeWeekly(trigger: TriggerConfig, t: TranslateFn, time: string): string {
  const days = joinList(t, normalizeWeekdays(trigger.weekdays).map((day) => weekdayLabel(t, day)));
  if (!trigger.repeatWithinDay) {
    return fill(t('flow.trigger.schedule.summary.weekly'), { days, time });
  }
  const endHour = clampInteger(trigger.endHour, 0, 23, SCHEDULE_DEFAULTS.endHour);
  const endMinute = clampInteger(trigger.endMinute, 0, 59, SCHEDULE_DEFAULTS.endMinute);
  return fill(t('flow.trigger.schedule.summary.weeklyWindow'), {
    days,
    start: time,
    end: formatTimeOfDay(endHour, endMinute),
    repeat: repeatLabel(
      t,
      trigger.repeatEveryValue ?? SCHEDULE_DEFAULTS.repeatEveryValue,
      trigger.repeatEveryUnit ?? SCHEDULE_DEFAULTS.repeatEveryUnit,
    ),
  });
}

/** One plain sentence for the whole schedule — the thing Google's picker never shows you. */
export function describeSchedule(trigger: TriggerConfig, t: TranslateFn): string {
  if (!hasStructuredSchedule(trigger)) return trigger.cronExpression ?? '';
  const mode = resolveScheduleMode(trigger);
  if (mode === 'interval') return describeInterval(trigger, t);

  const hour = clampInteger(trigger.scheduleHour, 0, 23, SCHEDULE_DEFAULTS.hour);
  const minute = clampInteger(trigger.scheduleMinute, 0, 59, SCHEDULE_DEFAULTS.minute);
  const time = formatTimeOfDay(hour, minute);

  if (mode === 'daily') return fill(t('flow.trigger.schedule.summary.daily'), { time });
  if (mode === 'weekly') return describeWeekly(trigger, t, time);

  if (mode === 'monthly') {
    const days = joinList(t, normalizeMonthDays(trigger.monthDays).map((day) => monthDayLabel(t, day)));
    return fill(t('flow.trigger.schedule.summary.monthly'), { days, time });
  }

  if (mode === 'yearly') {
    const month = clampInteger(trigger.scheduleMonth, 1, 12, SCHEDULE_DEFAULTS.month);
    return fill(t('flow.trigger.schedule.summary.yearly'), {
      month: t(`flow.trigger.schedule.month.${month}`),
      day: monthDayLabel(t, clampInteger(trigger.scheduleDay, 1, 31, SCHEDULE_DEFAULTS.day)),
      time,
    });
  }

  const once = parseOnceDate(trigger.onceDate);
  if (!once) return t('flow.trigger.schedule.noRun');
  return fill(t('flow.trigger.schedule.summary.once'), {
    date: fill(t('flow.trigger.schedule.dateFull'), { year: once.year, month: once.month, day: once.day }),
    time,
  });
}

export function formatRunTime(t: TranslateFn, date: Date): string {
  return fill(t('flow.trigger.schedule.nextRunItem'), {
    month: date.getMonth() + 1,
    day: date.getDate(),
    weekday: weekdayLabel(t, date.getDay()),
    time: formatTimeOfDay(date.getHours(), date.getMinutes()),
  });
}

export function formatRelativeTime(t: TranslateFn, date: Date, now: Date = new Date()): string {
  const delta = date.getTime() - now.getTime();
  if (delta < MINUTE_MS) return t('flow.trigger.schedule.relative.now');
  if (delta < HOUR_MS) {
    return fill(t('flow.trigger.schedule.relative.minutes'), { value: Math.round(delta / MINUTE_MS) });
  }
  if (delta < DAY_MS) {
    return fill(t('flow.trigger.schedule.relative.hours'), { value: Math.round(delta / HOUR_MS) });
  }
  return fill(t('flow.trigger.schedule.relative.days'), { value: Math.round(delta / DAY_MS) });
}

export function scheduleWarningKey(trigger: TriggerConfig, now: Date = new Date()): string | null {
  const mode = resolveScheduleMode(trigger);
  if (mode === 'once' && isOnceExpired(trigger, now)) return 'flow.trigger.schedule.onceExpired';
  if (mode !== 'weekly' || !trigger.repeatWithinDay) return null;
  const startTotal = clampInteger(trigger.scheduleHour, 0, 23, SCHEDULE_DEFAULTS.hour) * 60
    + clampInteger(trigger.scheduleMinute, 0, 59, SCHEDULE_DEFAULTS.minute);
  const endTotal = clampInteger(trigger.endHour, 0, 23, SCHEDULE_DEFAULTS.endHour) * 60
    + clampInteger(trigger.endMinute, 0, 59, SCHEDULE_DEFAULTS.endMinute);
  return endTotal <= startTotal ? 'flow.trigger.schedule.endTimeWarning' : null;
}
