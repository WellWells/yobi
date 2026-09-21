import type { TriggerConfig } from './types';
import {
  INTERVAL_HOUR_STEPS,
  INTERVAL_MINUTE_STEPS,
  LAST_DAY_OF_MONTH,
  SCHEDULE_DEFAULTS,
  clampInteger,
  daysInMonth,
  normalizeMonthDays,
  normalizeWeekdays,
  parseOnceDate,
  resolveScheduleMode,
  snapToStep,
  toIsoDate,
} from './flowScheduleCore';

function stepField(value: number): string {
  return value === 1 ? '*' : `*/${value}`;
}

function buildIntervalExpression(trigger: TriggerConfig): string {
  const unit = trigger.intervalUnit ?? SCHEDULE_DEFAULTS.intervalUnit;
  if (unit === 'minutes') {
    const value = snapToStep(trigger.intervalValue, INTERVAL_MINUTE_STEPS, SCHEDULE_DEFAULTS.intervalValue);
    return `${stepField(value)} * * * *`;
  }
  const value = snapToStep(trigger.intervalValue, INTERVAL_HOUR_STEPS, SCHEDULE_DEFAULTS.intervalValue);
  const offset = clampInteger(trigger.intervalMinuteOffset, 0, 59, SCHEDULE_DEFAULTS.intervalMinuteOffset);
  return `${offset} ${stepField(value)} * * *`;
}

/**
 * The repeat window used to be scheduled as a once-a-minute expression and filtered in a guard,
 * which woke the process 1440 times a day to run a handful of times. Both shapes below fire only
 * on real hits.
 */
function buildWindowExpression(trigger: TriggerConfig, dayField: string): string {
  const startHour = clampInteger(trigger.scheduleHour, 0, 23, SCHEDULE_DEFAULTS.hour);
  const startMinute = clampInteger(trigger.scheduleMinute, 0, 59, SCHEDULE_DEFAULTS.minute);
  const endHour = clampInteger(trigger.endHour, 0, 23, SCHEDULE_DEFAULTS.endHour);
  const endMinute = clampInteger(trigger.endMinute, 0, 59, SCHEDULE_DEFAULTS.endMinute);
  const unit = trigger.repeatEveryUnit ?? SCHEDULE_DEFAULTS.repeatEveryUnit;

  if (unit === 'hours') {
    const step = snapToStep(trigger.repeatEveryValue, INTERVAL_HOUR_STEPS, SCHEDULE_DEFAULTS.repeatEveryValue);
    const endTotal = endHour * 60 + endMinute;
    let lastHour = startHour;
    for (let hour = startHour; hour <= 23; hour += step) {
      if (hour * 60 + startMinute > endTotal) break;
      lastHour = hour;
    }
    const hourField = lastHour <= startHour ? String(startHour) : `${startHour}-${lastHour}/${step}`;
    return `${startMinute} ${hourField} * * ${dayField}`;
  }

  const step = snapToStep(trigger.repeatEveryValue, INTERVAL_MINUTE_STEPS, SCHEDULE_DEFAULTS.repeatEveryValue);
  const minutes: number[] = [];
  for (let minute = startMinute % step; minute < 60; minute += step) minutes.push(minute);
  const hourField = endHour <= startHour ? String(startHour) : `${startHour}-${endHour}`;
  return `${minutes.join(',')} ${hourField} * * ${dayField}`;
}

export function buildFlowCronExpression(trigger: TriggerConfig): string {
  const mode = resolveScheduleMode(trigger);
  if (mode === 'interval') return buildIntervalExpression(trigger);

  const minute = clampInteger(trigger.scheduleMinute, 0, 59, SCHEDULE_DEFAULTS.minute);
  const hour = clampInteger(trigger.scheduleHour, 0, 23, SCHEDULE_DEFAULTS.hour);

  if (mode === 'daily') return `${minute} ${hour} * * *`;

  if (mode === 'weekly') {
    const dayField = normalizeWeekdays(trigger.weekdays).join(',');
    if (trigger.repeatWithinDay) return buildWindowExpression(trigger, dayField);
    return `${minute} ${hour} * * ${dayField}`;
  }

  if (mode === 'monthly') {
    const dayField = normalizeMonthDays(trigger.monthDays)
      .map((day) => (day === LAST_DAY_OF_MONTH ? 'L' : String(day)))
      .join(',');
    return `${minute} ${hour} ${dayField} * *`;
  }

  if (mode === 'yearly') {
    const month = clampInteger(trigger.scheduleMonth, 1, 12, SCHEDULE_DEFAULTS.month);
    const day = clampInteger(trigger.scheduleDay, 1, daysInMonth(month), SCHEDULE_DEFAULTS.day);
    return `${minute} ${hour} ${day} ${month} *`;
  }

  const once = parseOnceDate(trigger.onceDate) ?? parseOnceDate(toIsoDate(new Date()));
  if (!once) return `${minute} ${hour} * * *`;
  return `${minute} ${hour} ${once.day} ${once.month} *`;
}

export function shouldNormalizeCronTrigger(trigger: TriggerConfig): boolean {
  if (trigger.type !== 'cron') return false;
  return Boolean(
    trigger.scheduleMode !== undefined
    || trigger.intervalValue !== undefined
    || trigger.intervalUnit !== undefined
    || trigger.intervalMinuteOffset !== undefined
    || trigger.weekdays !== undefined
    || trigger.scheduleHour !== undefined
    || trigger.scheduleMinute !== undefined
    || trigger.repeatWithinDay !== undefined
    || trigger.repeatEveryValue !== undefined
    || trigger.repeatEveryUnit !== undefined
    || trigger.endHour !== undefined
    || trigger.endMinute !== undefined
    || trigger.monthDays !== undefined
    || trigger.scheduleMonth !== undefined
    || trigger.scheduleDay !== undefined
    || trigger.onceDate !== undefined
    || !trigger.cronExpression,
  );
}

export function normalizeCronTrigger(trigger: TriggerConfig): TriggerConfig {
  if (trigger.type !== 'cron') return trigger;

  const mode = resolveScheduleMode(trigger);
  const normalized: TriggerConfig = { ...trigger, scheduleMode: mode };

  if (mode === 'interval') {
    const unit = trigger.intervalUnit ?? SCHEDULE_DEFAULTS.intervalUnit;
    normalized.intervalUnit = unit;
    normalized.intervalValue = snapToStep(
      trigger.intervalValue,
      unit === 'hours' ? INTERVAL_HOUR_STEPS : INTERVAL_MINUTE_STEPS,
      SCHEDULE_DEFAULTS.intervalValue,
    );
    if (unit === 'hours') {
      normalized.intervalMinuteOffset = clampInteger(
        trigger.intervalMinuteOffset, 0, 59, SCHEDULE_DEFAULTS.intervalMinuteOffset,
      );
    }
  } else {
    normalized.scheduleHour = clampInteger(trigger.scheduleHour, 0, 23, SCHEDULE_DEFAULTS.hour);
    normalized.scheduleMinute = clampInteger(trigger.scheduleMinute, 0, 59, SCHEDULE_DEFAULTS.minute);
  }

  if (mode === 'weekly') {
    normalized.weekdays = normalizeWeekdays(trigger.weekdays);
    normalized.repeatWithinDay = Boolean(trigger.repeatWithinDay);
    normalized.repeatEveryUnit = trigger.repeatEveryUnit ?? SCHEDULE_DEFAULTS.repeatEveryUnit;
    normalized.repeatEveryValue = snapToStep(
      trigger.repeatEveryValue,
      normalized.repeatEveryUnit === 'hours' ? INTERVAL_HOUR_STEPS : INTERVAL_MINUTE_STEPS,
      SCHEDULE_DEFAULTS.repeatEveryValue,
    );
    normalized.endHour = clampInteger(trigger.endHour, 0, 23, SCHEDULE_DEFAULTS.endHour);
    normalized.endMinute = clampInteger(trigger.endMinute, 0, 59, SCHEDULE_DEFAULTS.endMinute);
  }

  if (mode === 'monthly') normalized.monthDays = normalizeMonthDays(trigger.monthDays);

  if (mode === 'yearly') {
    normalized.scheduleMonth = clampInteger(trigger.scheduleMonth, 1, 12, SCHEDULE_DEFAULTS.month);
    normalized.scheduleDay = clampInteger(
      trigger.scheduleDay, 1, daysInMonth(normalized.scheduleMonth), SCHEDULE_DEFAULTS.day,
    );
  }

  if (mode === 'once') {
    normalized.onceDate = parseOnceDate(trigger.onceDate) ? String(trigger.onceDate) : toIsoDate(new Date());
  }

  normalized.cronExpression = buildFlowCronExpression(normalized);
  return normalized;
}

/**
 * Cron cannot express "from 09:30 to 18:00" when the repeat grid is finer than an hour, so the
 * expression covers whole hours and this trims the first and last hour's overshoot.
 */
export function shouldExecuteCronTriggerNow(trigger: TriggerConfig, now: Date = new Date()): boolean {
  if (trigger.type !== 'cron') return false;
  if (resolveScheduleMode(trigger) !== 'weekly') return true;
  if (!trigger.repeatWithinDay) return true;

  if (!normalizeWeekdays(trigger.weekdays).includes(now.getDay())) return false;

  const startTotal = clampInteger(trigger.scheduleHour, 0, 23, SCHEDULE_DEFAULTS.hour) * 60
    + clampInteger(trigger.scheduleMinute, 0, 59, SCHEDULE_DEFAULTS.minute);
  const endTotal = clampInteger(trigger.endHour, 0, 23, SCHEDULE_DEFAULTS.endHour) * 60
    + clampInteger(trigger.endMinute, 0, 59, SCHEDULE_DEFAULTS.endMinute);
  if (endTotal < startTotal) return false;

  const nowTotal = now.getHours() * 60 + now.getMinutes();
  return nowTotal >= startTotal && nowTotal <= endTotal;
}
