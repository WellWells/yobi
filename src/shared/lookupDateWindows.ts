/**
 * The date fields of the stock, forex and weather steps, read into the window a run asks for.
 * One parser for the executor (which turns a refusal into its `FlowUserError`) and the step editor
 * (which shows the same refusal under the field while typing), so the editor never accepts a value
 * the run then refuses, or the other way round.
 */
import { addDays, addMonths, addYears, daysBetween, localToday, parseDay, splitSpan, utcToday } from './dateSpan';

export const MAX_HISTORY_YEARS = 10;

export interface HistoryRequest {
  /** The summarised window: the period, or the date to today when no period was given. */
  from: string;
  to: string;
  date?: string;
  /** `to` is today (blank or clamped), so it may move to the exchange's own today. */
  openEnd: boolean;
  /** The fetched span: the window widened to hold `date`, which never moves the window itself. */
  fetchFrom: string;
  fetchTo: string;
}

/**
 * Why a history window was refused: the period cannot be read, or a date (the `date` field, or
 * the end of a period span that lies wholly before the 10-year limit) cannot be used.
 */
export type HistoryWindow =
  | { ok: true; request: HistoryRequest | null }
  | { ok: false; reason: 'period' | 'date'; value: string };

const PRESET = /^(\d{1,3})\s*(d|days?|w|wk|weeks?|m|mo|mos|months?|y|yr|years?)$/i;

function presetStart(raw: string, today: string): string | null {
  const text = raw.toLowerCase();
  if (text === 'ytd') return `${today.slice(0, 4)}-01-01`;
  if (text === 'max') return addYears(today, -MAX_HISTORY_YEARS);
  const m = PRESET.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2][0];
  if (unit === 'd') return addDays(today, -n);
  if (unit === 'w') return addDays(today, -7 * n);
  if (unit === 'm') return addMonths(today, -n);
  return addYears(today, -n);
}

/** `request: null` when both fields are blank: the step then runs exactly as it did before they existed. */
export function readHistoryWindow(config: Record<string, string>, now: Date): HistoryWindow {
  const periodRaw = (config.period ?? '').trim();
  const dateRaw = (config.date ?? '').trim();
  if (!periodRaw && !dateRaw) return { ok: true, request: null };
  const today = localToday(now);
  const earliest = addYears(today, -MAX_HISTORY_YEARS);
  const badPeriod = { ok: false, reason: 'period', value: periodRaw } as const;

  let from: string | null = null;
  let to = today;
  let openEnd = true;
  if (periodRaw) {
    const span = splitSpan(periodRaw);
    if (span) {
      from = parseDay(span[0], today);
      const end = parseDay(span[1], today);
      if (!from || !end) return badPeriod;
      openEnd = end >= today;
      to = openEnd ? today : end;
      // A span that ends before the limit reads fine but has nothing to show: name its end date.
      if (from <= to && to < earliest) return { ok: false, reason: 'date', value: span[1].trim() };
    } else {
      from = presetStart(periodRaw, today) ?? parseDay(periodRaw, today);
    }
    if (!from || from > to) return badPeriod;
    if (from < earliest) from = earliest;
  }

  let date: string | undefined;
  if (dateRaw) {
    const day = parseDay(dateRaw, today);
    // One day past the computer's: an exchange east of it may already be trading tomorrow.
    if (!day || day > addDays(today, 1) || day < earliest) return { ok: false, reason: 'date', value: dateRaw };
    date = day;
  }
  // Date only: the history runs from it to today. With a period, the date is read from the
  // fetched bars and the period's own figures stay those of the period asked for.
  const windowFrom = from ?? (date as string);
  const fetchFrom = date && date < windowFrom ? date : windowFrom;
  const fetchTo = date && date > to ? (date > today ? today : date) : to;
  return { ok: true, request: { from: windowFrom, to, date, openEnd, fetchFrom, fetchTo } };
}

export const FORECAST_PAST_DAYS = 92;
export const FORECAST_AHEAD_DAYS = 15;
export const FORECAST_MAX_SPAN_DAYS = 16;

export interface ForecastRequest {
  from: string;
  to: string;
  startHour: number;
  endHour: number;
  /**
   * The days actually requested: one more on each side where the source allows. Open-Meteo cuts
   * the span at today's offset, so a London summer date asked for in winter lost its 00:00 hour.
   */
  fetchFrom: string;
  fetchTo: string;
}

/**
 * Why a forecast window was refused: the hours or the date cannot be read, or the days lie outside
 * what the source keeps (`range`, which depends on the day the step runs).
 */
export type ForecastWindow =
  | { ok: true; request: ForecastRequest | null }
  | { ok: false; reason: 'hours' | 'date'; value: string }
  | { ok: false; reason: 'range'; value: string; first: string; last: string };

function readHours(raw: string): [number, number] | null {
  if (!raw) return [0, 23];
  const m = /^(\d{1,2})(?::00)?\s*(?:(?:-|~|～|到|至|–|—|\bto\b)\s*(\d{1,2})(?::00)?)?$/i.exec(raw);
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] === undefined ? start : Number(m[2]);
  if (start > 23 || end > 23 || start > end) return null;
  return [start, end];
}

/** `request: null` when both fields are blank: the step then runs exactly as it did before they existed. */
export function readForecastWindow(config: Record<string, string>, now: Date): ForecastWindow {
  const dateRaw = (config.date ?? '').trim();
  const hoursRaw = (config.hours ?? '').trim();
  if (!dateRaw && !hoursRaw) return { ok: true, request: null };
  const hours = readHours(hoursRaw);
  if (!hours) return { ok: false, reason: 'hours', value: hoursRaw };
  const [startHour, endHour] = hours;
  const today = localToday(now);
  const ends = dateRaw ? splitSpan(dateRaw) ?? [dateRaw, dateRaw] : [today, today];
  const from = parseDay(ends[0], today);
  const to = parseDay(ends[1], today);
  if (!from || !to || from > to || daysBetween(from, to) + 1 > FORECAST_MAX_SPAN_DAYS) {
    return { ok: false, reason: 'date', value: dateRaw };
  }
  const first = addDays(utcToday(now), -FORECAST_PAST_DAYS);
  const last = addDays(utcToday(now), FORECAST_AHEAD_DAYS);
  if (from < first || to > last) return { ok: false, reason: 'range', value: dateRaw || today, first, last };
  const before = addDays(from, -1);
  const after = addDays(to, 1);
  return {
    ok: true,
    request: {
      from, to, startHour, endHour,
      fetchFrom: before < first ? first : before,
      fetchTo: after > last ? last : after,
    },
  };
}
