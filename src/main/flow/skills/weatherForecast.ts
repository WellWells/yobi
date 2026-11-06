import { FlowUserError } from '../userError';
import { addDays, dateAtOffset, daysBetween, localToday, parseDay, splitSpan, utcToday, weekdayOf } from './dateSpan';
import { offsetFromZone, utcOffsetLabel } from './quoteTime';

const WMO_CODE_TEXT: Record<number, string> = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Depositing rime fog',
  51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
  56: 'Light freezing drizzle', 57: 'Dense freezing drizzle',
  61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
  66: 'Light freezing rain', 67: 'Heavy freezing rain',
  71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
  85: 'Slight snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail',
};

export function wmoText(code: number): string {
  return WMO_CODE_TEXT[code] ?? `code ${code}`;
}

/**
 * WMO numbers are not a severity scale: 80 "Slight rain showers" sorts above 65 "Heavy rain". A
 * day is summed up by its most significant weather, so codes are ranked here instead.
 */
const SEVERITY_GROUPS: ReadonlyArray<readonly number[]> = [
  [0], [1], [2], [3], [45, 48], [51], [53],
  [61, 66, 71, 80, 85, 77, 56], [63, 73, 81, 55], [65, 67, 75, 82, 86, 57], [95], [96], [99],
];
const SEVERITY = new Map<number, number>(SEVERITY_GROUPS.flatMap((codes, rank) => codes.map((code) => [code, rank + 1] as const)));

export function severityOf(code: number): number {
  return SEVERITY.get(code) ?? 0;
}

/** Open-Meteo's range is counted from the UTC date: 92 days back, 15 ahead. */
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

function badDate(value: string): FlowUserError {
  return new FlowUserError(
    'flow.error.weatherDate', { value },
    `Weather cannot read the date "${value}". Use YYYY-MM-DD, today, tomorrow, +N, or A..B for up to ${FORECAST_MAX_SPAN_DAYS} days.`,
  );
}

function badHours(value: string): FlowUserError {
  return new FlowUserError(
    'flow.error.weatherHours', { value },
    `Weather cannot read the hours "${value}". Use a range such as 13-18 (0-23).`,
  );
}

function readHours(raw: string): [number, number] {
  if (!raw) return [0, 23];
  const m = /^(\d{1,2})(?::00)?\s*(?:(?:-|~|～|到|至|–|—|\bto\b)\s*(\d{1,2})(?::00)?)?$/i.exec(raw);
  if (!m) throw badHours(raw);
  const start = Number(m[1]);
  const end = m[2] === undefined ? start : Number(m[2]);
  if (start > 23 || end > 23 || start > end) throw badHours(raw);
  return [start, end];
}

/** null when both fields are blank: the step then runs exactly as it did before they existed. */
export function readForecastRequest(config: Record<string, string>, now: Date): ForecastRequest | null {
  const dateRaw = (config.date ?? '').trim();
  const hoursRaw = (config.hours ?? '').trim();
  if (!dateRaw && !hoursRaw) return null;
  const [startHour, endHour] = readHours(hoursRaw);
  const today = localToday(now);
  const ends = dateRaw ? splitSpan(dateRaw) ?? [dateRaw, dateRaw] : [today, today];
  const from = parseDay(ends[0], today);
  const to = parseDay(ends[1], today);
  if (!from || !to || from > to || daysBetween(from, to) + 1 > FORECAST_MAX_SPAN_DAYS) throw badDate(dateRaw);
  const first = addDays(utcToday(now), -FORECAST_PAST_DAYS);
  const last = addDays(utcToday(now), FORECAST_AHEAD_DAYS);
  if (from < first || to > last) {
    const value = dateRaw || today;
    throw new FlowUserError(
      'flow.error.weatherRange', { value, first, last },
      `Weather has data from ${first} to ${last}; "${value}" is outside that range.`,
    );
  }
  const before = addDays(from, -1);
  const after = addDays(to, 1);
  return {
    from, to, startHour, endHour,
    fetchFrom: before < first ? first : before,
    fetchTo: after > last ? last : after,
  };
}

export function forecastUrl(latitude: number, longitude: number, req: ForecastRequest, imperial: boolean): string {
  return `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}`
    + '&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m'
    + `&timezone=auto&timeformat=unixtime&start_date=${req.fetchFrom}&end_date=${req.fetchTo}`
    + `&temperature_unit=${imperial ? 'fahrenheit' : 'celsius'}&wind_speed_unit=${imperial ? 'mph' : 'kmh'}`
    + `&precipitation_unit=${imperial ? 'inch' : 'mm'}`;
}

export interface HourlyForecast {
  timezone?: string;
  utc_offset_seconds?: number;
  hourly_units?: Record<string, string>;
  hourly?: {
    time?: number[];
    temperature_2m?: Array<number | null>;
    apparent_temperature?: Array<number | null>;
    precipitation_probability?: Array<number | null>;
    precipitation?: Array<number | null>;
    weather_code?: Array<number | null>;
    wind_speed_10m?: Array<number | null>;
    wind_gusts_10m?: Array<number | null>;
  };
}

interface Hour {
  date: string; hour: number; offset: number;
  temp: number | null; feels: number | null; rain: number | null; precip: number | null;
  code: number | null; wind: number | null; gust: number | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round = (v: number | null, places = 0): number | null => (v === null ? null : Number(v.toFixed(places)));

function present(values: Array<number | null>): number[] {
  return values.filter((v): v is number => v !== null);
}

function maxOf(values: Array<number | null>): number | null {
  const xs = present(values);
  return xs.length ? Math.max(...xs) : null;
}

function minOf(values: Array<number | null>): number | null {
  const xs = present(values);
  return xs.length ? Math.min(...xs) : null;
}

/** The most significant weather of the hours; ties go to the one that lasts longest. */
export function dominantCode(codes: Array<number | null>): number | null {
  const counts = new Map<number, number>();
  for (const code of present(codes)) counts.set(code, (counts.get(code) ?? 0) + 1);
  let best: number | null = null;
  for (const [code, count] of counts) {
    if (best === null) { best = code; continue; }
    const diff = severityOf(code) - severityOf(best);
    if (diff > 0 || (diff === 0 && count > (counts.get(best) ?? 0))) best = code;
  }
  return best;
}

function hoursOf(data: HourlyForecast, req: ForecastRequest): Hour[] {
  const h = data.hourly ?? {};
  const zone = data.timezone ?? '';
  const fallback = data.utc_offset_seconds ?? 0;
  const hours: Hour[] = [];
  (h.time ?? []).forEach((ts, i) => {
    if (typeof ts !== 'number') return;
    // Open-Meteo applies today's offset to the whole span; the zone name gives each hour its own.
    const offset = (zone ? offsetFromZone(zone, ts) : null) ?? fallback;
    const local = new Date((ts + offset) * 1_000).toISOString();
    const date = local.slice(0, 10);
    const hour = Number(local.slice(11, 13));
    if (date < req.from || date > req.to || hour < req.startHour || hour > req.endHour) return;
    hours.push({
      date, hour, offset,
      temp: num(h.temperature_2m?.[i]), feels: num(h.apparent_temperature?.[i]),
      rain: num(h.precipitation_probability?.[i]), precip: num(h.precipitation?.[i]),
      code: num(h.weather_code?.[i]), wind: num(h.wind_speed_10m?.[i]), gust: num(h.wind_gusts_10m?.[i]),
    });
  });
  return hours;
}

export const ROW_STEPS = [1, 2, 3, 6] as const;

/** Every N-th hour from the window start, the finest N whose rows fit; 0 = none fit. */
export function rowStep(hours: Array<{ hour: number }>, startHour: number, days: number): number {
  const maxRows = days <= 7 ? 48 : 24;
  return ROW_STEPS.find((step) => hours.filter((h) => (h.hour - startHour) % step === 0).length <= maxRows) ?? 0;
}

const DAY_COLS = ['date', 'weekday', 'kind', 'condition', 'high', 'low', 'feelsHigh', 'feelsLow', 'rainChanceMax', 'precipTotal', 'wetHours', 'windMax', 'gustMax'];
const HOUR_COLS = ['hour', 'temp', 'feelsLike', 'rainChance', 'precip', 'wind', 'gust', 'code'];

export interface ForecastContext {
  displayName: string;
  imperial: boolean;
  nowSec: number;
}

/** The step's envelope fields, or null when the source returned no hour inside the request. */
export function forecastResult(data: HourlyForecast, req: ForecastRequest, ctx: ForecastContext): { output: string; subVars: Record<string, string> } | null {
  const hours = hoursOf(data, req);
  if (hours.length === 0) return null;
  const zone = data.timezone ?? 'GMT';
  const precipPlaces = ctx.imperial ? 2 : 1;
  const placeToday = dateAtOffset(ctx.nowSec, (zone ? offsetFromZone(zone, ctx.nowSec) : null) ?? data.utc_offset_seconds ?? 0);
  const dates = [...new Set(hours.map((h) => h.date))];
  const days = dates.map((date) => {
    const day = hours.filter((h) => h.date === date);
    const precip = present(day.map((h) => h.precip));
    const code = dominantCode(day.map((h) => h.code));
    return [
      date, weekdayOf(date), date < placeToday ? 'past' : date === placeToday ? 'today' : 'forecast',
      code === null ? null : wmoText(code),
      round(maxOf(day.map((h) => h.temp)), 1), round(minOf(day.map((h) => h.temp)), 1),
      round(maxOf(day.map((h) => h.feels)), 1), round(minOf(day.map((h) => h.feels)), 1),
      maxOf(day.map((h) => h.rain)),
      precip.length ? round(precip.reduce((a, b) => a + b, 0), precipPlaces) : null,
      precip.length ? precip.filter((p) => p > 0).length : null,
      round(maxOf(day.map((h) => h.wind))), round(maxOf(day.map((h) => h.gust))),
    ] as const;
  });
  const step = rowStep(hours, req.startHour, dates.length);
  const hourly: Record<string, unknown[]> = {};
  const codes: Record<string, string> = {};
  if (step > 0) {
    for (const h of hours) {
      if ((h.hour - req.startHour) % step !== 0) continue;
      (hourly[h.date] ??= []).push([h.hour, round(h.temp), round(h.feels), h.rain, round(h.precip, precipPlaces), round(h.wind), round(h.gust), h.code]);
      if (h.code !== null) codes[String(h.code)] = wmoText(h.code);
    }
  }
  const offsets = [...new Set(hours.map((h) => h.offset))].map(utcOffsetLabel);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const tempUnit = data.hourly_units?.temperature_2m ?? (ctx.imperial ? '°F' : '°C');
  const json: Record<string, unknown> = {
    location: ctx.displayName,
    source: 'Open-Meteo',
    timezone: `${zone} (${offsets.join('/')})`,
    from: dates[0],
    to: dates[dates.length - 1],
    hours: `${pad(req.startHour)}-${pad(req.endHour)}`,
    units: { temp: tempUnit, precip: ctx.imperial ? 'inch' : 'mm', wind: ctx.imperial ? 'mph' : 'km/h' },
    dayCols: DAY_COLS,
    days,
    step: step > 0 ? `${step}h` : 'none',
    hourCols: HOUR_COLS,
    hourly,
    codes,
  };
  if (step === 0) json.hint = 'span too long for hourly rows; ask for 7 days or fewer';
  if (days.some((d) => d[2] === 'past')) json.past = 'model data, not station records';
  const first = days[0];
  const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
  return {
    output: JSON.stringify(json),
    subVars: {
      location: ctx.displayName,
      timezone: String(json.timezone),
      from: String(json.from),
      to: String(json.to),
      unit: tempUnit,
      high: str(first[4]),
      low: str(first[5]),
      rainChance: str(first[8]),
      condition: str(first[3]),
      precipitation: str(first[9]),
      isFailed: '0',
    },
  };
}
