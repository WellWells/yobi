/**
 * Which days Taiwan's operators run their holiday timetables on: weekends and the national
 * holidays of the official office calendar (行政院人事行政總處 辦公日曆表), minus the make-up
 * workdays it moves onto a Saturday. Timetables follow that calendar, so a weekday national
 * holiday (國慶日) must read as a day off and a make-up Saturday as a workday. The data and its
 * source are in `taiwanCalendarData.ts`.
 */
import { addDays } from '../rail/railTime';
import { CALENDAR_DATA, CALENDAR_DATA_YEARS } from './taiwanCalendarData';

/** The official calendar's exceptions to "Saturday and Sunday off", by `YYYY-MM-DD`. */
export const CALENDAR_EXCEPTIONS: Readonly<Record<string, 'off' | 'work'>> = Object.fromEntries(CALENDAR_DATA);

/** The years whose official calendar is bundled; outside them only weekends are known. */
export const CALENDAR_YEARS: readonly number[] = CALENDAR_DATA_YEARS;

function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function isWeekend(date: string): boolean {
  const day = weekday(date);
  return day === 0 || day === 6;
}

/** Whether the official calendar for `date`'s year is bundled. */
export function calendarKnown(date: string): boolean {
  return CALENDAR_YEARS.includes(Number(date.slice(0, 4)));
}

/** A day off: a weekend or national holiday, not a make-up workday. */
export function isOffDay(date: string): boolean {
  const exception = CALENDAR_EXCEPTIONS[date];
  if (exception) return exception === 'off';
  return isWeekend(date);
}

/** A national holiday that falls on a weekday (the case a weekday rule gets wrong). */
export function isWeekdayHoliday(date: string): boolean {
  return CALENDAR_EXCEPTIONS[date] === 'off' && !isWeekend(date);
}

/** A Saturday or Sunday the official calendar makes a workday (補行上班). */
export function isMakeUpWorkday(date: string): boolean {
  return CALENDAR_EXCEPTIONS[date] === 'work' && isWeekend(date);
}

/** A workday followed by a day off (KRTC's 假日前一日 timetable). */
export function isDayBeforeOffDay(date: string): boolean {
  return !isOffDay(date) && isOffDay(addDays(date, 1));
}

/**
 * The exceptions one year's official CSV gives ("西元日期,星期,是否放假,備註"; 是否放假 0 = work,
 * 2 = off), in date order. Throws when the file is not that table.
 */
export function parseOfficeCalendarCsv(csv: string): [string, 'off' | 'work'][] {
  const lines = csv.replace(/^﻿/u, '').split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const header = lines[0]?.split(',').map((cell) => cell.trim()) ?? [];
  const dateAt = header.indexOf('西元日期');
  const offAt = header.indexOf('是否放假');
  if (dateAt < 0 || offAt < 0) throw new Error('office calendar CSV has no 西元日期/是否放假 columns');
  const out: [string, 'off' | 'work'][] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',').map((cell) => cell.trim());
    const raw = /^(\d{4})(\d{2})(\d{2})$/u.exec(cells[dateAt] ?? '');
    const flag = cells[offAt];
    if (!raw || (flag !== '0' && flag !== '2')) throw new Error(`office calendar CSV row not understood: ${line}`);
    const date = `${raw[1]}-${raw[2]}-${raw[3]}`;
    const off = flag === '2';
    if (off !== isWeekend(date)) out.push([date, off ? 'off' : 'work']);
  }
  if (lines.length < 366) throw new Error(`office calendar CSV has ${lines.length - 1} days, not a year`);
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}
