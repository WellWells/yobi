import type { FlowDefinition, TriggerConfig } from './types';
import { daysInMonth, isOnceExpired, onceDueAt, resolveScheduleMode } from './flowScheduleCore';
import { normalizeCronTrigger } from './flowScheduleBuild';

/**
 * "Do it later" as a flow. The flow compiler writes a one-time schedule as `{"type":"cron","runAt":
 * "YYYY-MM-DD HH:mm"}` — one local moment, which a model gets right far more often than the
 * editor's split fields plus a matching cron line — and validation turns it into the editor's own
 * one-time schedule (`scheduleMode: 'once'`), set to delete the flow after its run succeeds.
 */

const RUN_AT_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** A local moment as the prompts write it: `2026-11-17 17:40 (Tuesday)`. */
export function formatLocalMoment(date: Date): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())} (${WEEKDAYS[date.getDay()]})`;
}

/**
 * The one-time schedule a `runAt` stands for, or why it cannot be one. The moment must still be
 * ahead: a saved schedule whose moment has passed never runs (saving is not a catch-up).
 */
export function oneTimeTriggerFromRunAt(
  runAt: string,
  now: Date = new Date(),
): { ok: true; trigger: TriggerConfig } | { ok: false; error: string } {
  const match = RUN_AT_RE.exec(runAt.trim());
  const usage = 'write "runAt" as "YYYY-MM-DD HH:mm" in the user\'s local time';
  if (!match) return { ok: false, error: `Invalid runAt "${runAt}" — ${usage}` };
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(month, year) || hour > 23 || minute > 59) {
    return { ok: false, error: `Invalid runAt "${runAt}" — no such date or time; ${usage}` };
  }
  const trigger = normalizeCronTrigger({
    type: 'cron',
    scheduleMode: 'once',
    onceDate: `${year}-${pad(month)}-${pad(day)}`,
    scheduleHour: hour,
    scheduleMinute: minute,
    catchUpMissed: true,
    deleteAfterRun: true,
  });
  if (isOnceExpired(trigger, now)) {
    return { ok: false, error: `runAt "${runAt}" is not in the future — it is now ${formatLocalMoment(now)}; pick a later moment` };
  }
  return { ok: true, trigger };
}

export function isOneTimeSchedule(trigger: TriggerConfig): boolean {
  return trigger.type === 'cron' && resolveScheduleMode(trigger) === 'once';
}

/** The moment a flow whose only trigger is a one-time schedule runs; null for every other flow. */
export function oneTimeRunAt(flow: Pick<FlowDefinition, 'trigger' | 'extraTriggers'>): Date | null {
  if ((flow.extraTriggers?.length ?? 0) > 0 || !isOneTimeSchedule(flow.trigger)) return null;
  return onceDueAt(flow.trigger);
}

/** `YYYY-MM-DDTHH:mm`, local: how the confirmation carries the moment to the renderer, which formats it. */
export function localIsoMinute(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
