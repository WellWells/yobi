/**
 * How the almanac step reads its date field, without the lunar calendar: whether it names one day,
 * a month, a year or a range. One copy for the executor (which converts a lunar span with the
 * almanac library) and the step editor (which shows the span's length in the days field).
 */

export interface YmdParts {
  year: number;
  month: number;
  day: number;
}

export type AlmanacSpanShape =
  | { kind: 'month'; year: number; month: number }
  | { kind: 'year'; year: number }
  | { kind: 'range'; from: YmdParts; to: YmdParts };

const DAY_MS = 86_400_000;

/** A day count in "days" — "30", "30天", "30 days", capped later. A bare year is a span instead. */
export const ALMANAC_DAY_COUNT = /^(\d+)(?:\.\d+)?\s*(?:天|日|days?)?$/i;
export const ALMANAC_BARE_YEAR = /^(19\d\d|20\d\d|2100)$/;
const RANGE = /^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\s*(?:to|~|～|\.\.|至|到|–|—|\s-\s)\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})$/i;

export function parseYmdParts(raw: string): YmdParts | null {
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(raw);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function ymdDayNumber(d: YmdParts): number {
  return Date.UTC(d.year, d.month - 1, d.day) / DAY_MS;
}

/** A month ("2026-11"), a year ("2027") or a range ("2027-01-01 to 2027-06-30"); null otherwise. */
export function almanacSpanShape(raw: string): AlmanacSpanShape | null {
  const month = /^(\d{4})[-/.](\d{1,2})$/.exec(raw);
  if (month) {
    const m = Number(month[2]);
    return m >= 1 && m <= 12 ? { kind: 'month', year: Number(month[1]), month: m } : null;
  }
  const year = ALMANAC_BARE_YEAR.exec(raw);
  if (year) return { kind: 'year', year: Number(year[1]) };
  const range = RANGE.exec(raw);
  const from = range ? parseYmdParts(range[1]) : null;
  const to = range ? parseYmdParts(range[2]) : null;
  return from && to ? { kind: 'range', from, to } : null;
}

/** A Gregorian span as its first day and length; null for a range that ends before it starts. */
export function gregorianSpan(shape: AlmanacSpanShape): { start: YmdParts; days: number } | null {
  if (shape.kind === 'month') {
    return { start: { year: shape.year, month: shape.month, day: 1 }, days: new Date(shape.year, shape.month, 0).getDate() };
  }
  if (shape.kind === 'year') {
    const start = { year: shape.year, month: 1, day: 1 };
    return { start, days: ymdDayNumber({ year: shape.year + 1, month: 1, day: 1 }) - ymdDayNumber(start) };
  }
  const days = ymdDayNumber(shape.to) - ymdDayNumber(shape.from) + 1;
  return days >= 1 ? { start: shape.from, days } : null;
}

/** Any filter (an activity, signs to avoid, weekends only) turns the step into "pick good days". */
export function almanacFiltered(config: Record<string, string>): boolean {
  return Boolean((config.activity ?? '').trim()) || Boolean((config.zodiac ?? '').trim()) || config.weekends === 'true';
}

/**
 * How many days the date field names, for the editor's days field: a number for a Gregorian
 * month, year or range, `byDate` for a lunar one (its length needs the lunar calendar), null when
 * the date is one day and the days field decides.
 */
export function almanacDateSpanDays(config: Record<string, string>): number | 'byDate' | null {
  const shape = almanacSpanShape((config.date ?? '').trim());
  if (!shape) return null;
  if (config.lunar === 'true') return 'byDate';
  return gregorianSpan(shape)?.days ?? null;
}

/**
 * Whether the run looks up one day (the only case that reads `time` and sets `.eightChar`):
 * the date names no span, and the days field is blank, 1 or holds no span either.
 */
export function almanacOneDay(config: Record<string, string>): boolean {
  if (almanacDateSpanDays(config) !== null) return false;
  const days = (config.days ?? '').trim();
  if (!days) return true;
  const count = ALMANAC_BARE_YEAR.test(days) ? null : ALMANAC_DAY_COUNT.exec(days);
  return count ? Number(count[1]) <= 1 : false;
}
