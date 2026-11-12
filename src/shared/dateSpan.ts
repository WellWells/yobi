/**
 * Calendar days as "YYYY-MM-DD" strings. The arithmetic runs on UTC midnights, so it never meets a
 * daylight-saving hour; whose day "today" is stays the caller's choice.
 */

const DAY_MS = 86_400_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export type Weekday = typeof WEEKDAYS[number];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function ymdOf(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
}

function toUtcMs(ymd: string): number {
  return Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The computer's own date: what "today" and "tomorrow" mean to the person typing them. */
export function localToday(now: Date): string {
  return ymdOf(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function utcToday(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** The calendar date at a UTC offset. */
export function dateAtOffset(epochSec: number, offsetSec: number): string {
  return fromUtcMs((epochSec + offsetSec) * 1_000);
}

export function addDays(ymd: string, n: number): string {
  return fromUtcMs(toUtcMs(ymd) + n * DAY_MS);
}

/** Clamps to the month's last day: 2026-03-31 minus one month is 2026-02-28. */
export function addMonths(ymd: string, n: number): string {
  const total = Number(ymd.slice(0, 4)) * 12 + Number(ymd.slice(5, 7)) - 1 + n;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return ymdOf(year, month, Math.min(Number(ymd.slice(8, 10)), last));
}

export function addYears(ymd: string, n: number): string {
  return addMonths(ymd, n * 12);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / DAY_MS);
}

export function weekdayOf(ymd: string): Weekday {
  return WEEKDAYS[new Date(toUtcMs(ymd)).getUTCDay()];
}

/** UTC midnight of the day, in epoch seconds. */
export function epochSecOf(ymd: string): number {
  return toUtcMs(ymd) / 1_000;
}

/** A Map, not an object literal: `in` would also match "constructor" and other inherited keys. */
const RELATIVE_WORDS = new Map<string, number>([
  ['today', 0], ['tomorrow', 1], ['yesterday', -1],
  ['今天', 0], ['今日', 0], ['明天', 1], ['明日', 1], ['後天', 2], ['后天', 2], ['昨天', -1], ['昨日', -1],
]);

/**
 * A single day: YYYY-MM-DD (also / or . and one-digit month or day), a relative word, or +N / -N
 * days from `today`. A day that does not exist (2026-02-30) is null, not rolled over.
 */
export function parseDay(raw: string, today: string): string | null {
  const text = raw.trim().toLowerCase();
  const relative = RELATIVE_WORDS.get(text);
  if (relative !== undefined) return addDays(today, relative);
  const offset = /^([+-])\s*(\d{1,4})$/.exec(text);
  if (offset) return addDays(today, (offset[1] === '-' ? -1 : 1) * Number(offset[2]));
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1) return null;
  const ymd = ymdOf(year, month, day);
  return fromUtcMs(toUtcMs(ymd)) === ymd ? ymd : null;
}

/** Models write a span every way a sentence allows, so every common separator is read. */
const SPAN_SEPARATOR = /\s*(?:\.\.|~|～|\bto\b|至|到|–|—|\s-\s|,|，)\s*/i;

/** "A..B" as its two ends, or null when there is no separator (a single day). */
export function splitSpan(raw: string): [string, string] | null {
  const parts = raw.trim().split(SPAN_SEPARATOR);
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return [parts[0], parts[1]];
}
