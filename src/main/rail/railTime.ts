/**
 * Railway time is Taipei time, whatever the computer's own zone: a Yobi in Tokyo asking about the
 * next train to Kaohsiung means Taipei's "now". Times inside a timetable are minutes after 00:00 of
 * the train's service day, so a train that crosses midnight runs past 1440.
 */
import type { RailNode, RailStop } from './railTypes';

export const DAY_MINUTES = 1_440;
const TAIPEI = 'Asia/Taipei';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** "07:55" or "19:48:30" → minutes after midnight (seconds dropped); NaN for anything else. */
export function clockMinutes(text: string): number {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/u.exec(text.trim());
  if (!match) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Stops in calling order with times as printed (each in 0..1439): a time earlier than the one
 * before it means the train passed midnight, so it and everything after move to the next day.
 */
export function rollStops(raw: readonly { node: RailNode; arr: number; dep: number }[]): RailStop[] {
  let offset = 0;
  let last = -1;
  const stops: RailStop[] = [];
  for (const stop of raw) {
    const arrRaw = Number.isFinite(stop.arr) ? stop.arr : stop.dep;
    const depRaw = Number.isFinite(stop.dep) ? stop.dep : arrRaw;
    if (!Number.isFinite(arrRaw)) continue;
    if (arrRaw + offset < last) offset += DAY_MINUTES;
    const arr = arrRaw + offset;
    if (depRaw + offset < arr) offset += DAY_MINUTES;
    const dep = depRaw + offset;
    stops.push({ node: stop.node, arr, dep });
    last = dep;
  }
  return stops;
}

export interface TaipeiClock {
  /** `YYYY-MM-DD` in Taipei. */
  date: string;
  /** Minutes after Taipei midnight. */
  minutes: number;
  weekday: (typeof WEEKDAYS)[number];
}

export function taipeiClock(now: Date): TaipeiClock {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TAIPEI, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
    }).formatToParts(now).map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: parts.weekday as TaipeiClock['weekday'],
  };
}

/** Minutes left until Taipei midnight. */
export function minutesToTaipeiMidnight(now: Date): number {
  const clock = taipeiClock(now);
  return DAY_MINUTES - clock.minutes;
}

/** 425 → "07:05"; 1450 → "00:10 (+1)". */
export function formatClock(minutes: number): string {
  const day = Math.floor(minutes / DAY_MINUTES);
  const within = minutes - day * DAY_MINUTES;
  const text = `${String(Math.floor(within / 60)).padStart(2, '0')}:${String(within % 60).padStart(2, '0')}`;
  return day > 0 ? `${text} (+${day})` : text;
}

/** 125 → "2h05m". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** "2026-10-15 11:40 (Thu) Asia/Taipei" — the time the answer was computed for. */
export function formatQueryTime(now: Date): string {
  const clock = taipeiClock(now);
  return `${clock.date} ${formatClock(clock.minutes)} (${clock.weekday}) ${TAIPEI}`;
}

export function isIsoDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

/** Whole days from `from` to `to` (both `YYYY-MM-DD`). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
