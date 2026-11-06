import { localDateLabel, localMidnight } from './calendarFormat';
import type { EventTimes } from './eventIcs';

/**
 * Times as the calendar tools take and give them. In: "2026-10-29" (a date), "2026-10-29T15:00"
 * (this computer's wall clock) or an ISO time with Z/offset. Out: local time with its offset, and
 * all-day events as dates whose `end` is the last day (as the calendar step prints them).
 */

export class CalendarArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalendarArgumentError';
  }
}

export interface ParsedWhen {
  date: Date;
  dateOnly: boolean;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const ZONED_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

/** The longest span an event may cover, and a read may ask for. */
export const MAX_EVENT_SPAN_DAYS = 366;
export const MAX_READ_SPAN_DAYS = 92;

function validDate(date: Date, raw: string, key: string): Date {
  if (Number.isNaN(date.getTime())) throw new CalendarArgumentError(`${key} "${raw}" is not a real date`);
  return date;
}

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/;

/** Refuses a day the month does not have and a time past 23:59:59, instead of rolling it over. */
function assertRealWallClock(value: string, raw: string, key: string): void {
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = WALL_CLOCK.exec(value) ?? [];
  const month = Number(mo);
  const lastDay = new Date(Date.UTC(Number(y), month, 0)).getUTCDate();
  if (month < 1 || month > 12 || Number(d) < 1 || Number(d) > lastDay || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) {
    throw new CalendarArgumentError(`${key} "${raw}" is not a real date and time`);
  }
}

export function parseWhen(raw: string, key: string): ParsedWhen {
  const value = raw.trim();
  let match = DATE_ONLY.exec(value);
  if (match) {
    assertRealWallClock(value, raw, key);
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return { date: validDate(date, raw, key), dateOnly: true };
  }
  match = LOCAL_TIME.exec(value);
  if (match) {
    assertRealWallClock(value, raw, key);
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0));
    return { date: validDate(date, raw, key), dateOnly: false };
  }
  if (ZONED_TIME.test(value)) {
    assertRealWallClock(value, raw, key);
    return { date: validDate(new Date(value.replace(' ', 'T')), raw, key), dateOnly: false };
  }
  throw new CalendarArgumentError(`${key} must be YYYY-MM-DD or YYYY-MM-DDTHH:MM (local time), not "${raw}"`);
}

function pad(n: number): string {
  return String(Math.abs(n)).padStart(2, '0');
}

/** "2026-10-29T15:00+08:00": local wall clock with the offset it had at that moment. */
export function localIso(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  return `${localDateLabel(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
}

export function formatTimes(times: EventTimes): { start: string; end: string; all_day: boolean } {
  if (!times.allDay) return { start: localIso(times.start), end: localIso(times.end), all_day: false };
  const last = localMidnight(times.end, -1);
  return { start: localDateLabel(times.start), end: localDateLabel(last < times.start ? times.start : last), all_day: true };
}

const HOUR_MS = 3_600_000;

/**
 * The times an event gets from the tool's arguments. `end` of an all-day event is its last day;
 * a timed event without one lasts an hour. `base` is the event being changed: a new start keeps
 * its length, and what is not given stays.
 */
export function eventTimesFrom(
  args: { start?: string; end?: string; allDay?: boolean },
  base?: EventTimes,
): EventTimes {
  const start = args.start ? parseWhen(args.start, 'start') : undefined;
  const end = args.end ? parseWhen(args.end, 'end') : undefined;
  if (!start && !base) throw new CalendarArgumentError('start is required');
  const allDay = args.allDay ?? (start ? start.dateOnly : base?.allDay ?? false);
  const day = (date: Date): Date => localMidnight(date, 0);

  let from: Date;
  if (start) from = allDay ? day(start.date) : start.date;
  else from = allDay ? day((base as EventTimes).start) : (base as EventTimes).start;
  if (!allDay && start?.dateOnly) throw new CalendarArgumentError('A timed event needs a start time (YYYY-MM-DDTHH:MM); for a whole day set all_day');

  let to: Date;
  if (end) {
    to = allDay ? localMidnight(end.date, 1) : end.date;
    if (!allDay && end.dateOnly) throw new CalendarArgumentError('end needs a time (YYYY-MM-DDTHH:MM) for a timed event');
  } else if (base && base.allDay === allDay) {
    const length = base.end.getTime() - base.start.getTime();
    // Whole days are counted, not hours: a span across a DST change still ends at midnight.
    to = allDay ? localMidnight(from, Math.max(1, Math.round(length / (24 * HOUR_MS)))) : new Date(from.getTime() + length);
  } else {
    to = allDay ? localMidnight(from, 1) : new Date(from.getTime() + HOUR_MS);
  }
  if (to.getTime() <= from.getTime()) throw new CalendarArgumentError('end must be after start');
  if (to.getTime() - from.getTime() > MAX_EVENT_SPAN_DAYS * 24 * HOUR_MS) throw new CalendarArgumentError(`An event may span at most ${MAX_EVENT_SPAN_DAYS} days`);
  return { start: from, end: to, allDay };
}
