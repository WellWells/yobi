import type { ScheduledTask } from 'node-cron';
import type { TriggerConfig } from '../../shared/types';
import {
  isOnceExpired,
  onceDueAt,
  resolveScheduleMode,
  shouldExecuteCronTriggerNow,
} from '../../shared/flowSchedule';

/**
 * The most cron ticks the guard can trim before the next allowed one: the end hour's overshoot past
 * the window plus the start hour's lead-in before it, each under 60. Other hours and days are not
 * cron matches at all, so this bound holds however far away the next window day is.
 */
const MAX_TRIMMED_TICKS = 120;

const MINUTE_MS = 60_000;

/**
 * The next `wanted` moments the trigger will really run, as opposed to the raw cron matches, which
 * include a one-time date's earlier years and a repeat window's whole-hour overshoot. The preview,
 * the remembered next run and catch-up all read this so none of them can promise a trimmed tick.
 */
export function nextAllowedRuns(
  source: Pick<ScheduledTask, 'getNextRuns'>,
  trigger: TriggerConfig,
  wanted: number,
): Date[] {
  if (resolveScheduleMode(trigger) === 'once') {
    const due = onceDueAt(trigger);
    return due && !isOnceExpired(trigger) ? [due] : [];
  }
  const cap = wanted * (MAX_TRIMMED_TICKS + 1);
  // Most schedules trim nothing, so start small and only widen while ticks are being trimmed.
  for (let count = wanted; ; count = Math.min(cap, count * 8)) {
    const runs = source.getNextRuns(count).filter((date) => shouldExecuteCronTriggerNow(trigger, date));
    if (runs.length >= wanted || count >= cap) return runs.slice(0, wanted);
  }
}

/**
 * The first allowed run at or after `from` and no later than `until`, or null. Walks minute by minute
 * because node-cron only searches forward from now; callers bound the span to the catch-up window.
 */
export function firstAllowedRunBetween(
  task: Pick<ScheduledTask, 'match'>,
  trigger: TriggerConfig,
  from: number,
  until: number,
): number | null {
  for (let time = Math.ceil(from / MINUTE_MS) * MINUTE_MS; time <= until; time += MINUTE_MS) {
    const date = new Date(time);
    if (shouldExecuteCronTriggerNow(trigger, date) && task.match(date)) return time;
  }
  return null;
}

/**
 * Whether the one-shot's `m h D M *` first matches on its own date. A date more than a year out
 * matches the same day in an earlier year first, and a single-execution budget would be spent on
 * that skipped tick.
 */
export function onceIsFirstCronMatch(trigger: TriggerConfig, now: Date = new Date()): boolean {
  const due = onceDueAt(trigger);
  if (!due) return false;
  for (let year = now.getFullYear(); year < due.getFullYear(); year += 1) {
    const candidate = new Date(year, due.getMonth(), due.getDate(), due.getHours(), due.getMinutes());
    // Feb 29 rolls over to March in a common year, where cron does not match it.
    if (candidate.getMonth() === due.getMonth() && candidate.getTime() > now.getTime()) return false;
  }
  return true;
}
