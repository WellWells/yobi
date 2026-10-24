/**
 * The calendar step's windows and output shapes. Kept apart from the ics parser so the flow
 * step and the settings test can format without loading ical.js until a feed is actually read.
 */

/** One event occurrence, in absolute time: what a calendar step hands on. */
export interface CalendarEvent {
  title: string;
  /** The event's own URL property; '' when it has none. */
  link: string;
  location: string;
  start: Date;
  /** Exclusive: an all-day event ends at local midnight after its last day. */
  end: Date;
  allDay: boolean;
}

/** The local-time window a step reads: `start` inclusive, `end` exclusive. */
export interface CalendarWindow {
  start: Date;
  end: Date;
}

export const DEFAULT_CALENDAR_DAYS = 7;
export const MAX_CALENDAR_DAYS = 31;

const BYTE_ORDER_MARK = String.fromCharCode(0xfe_ff);

/** The ics text is not a calendar (an HTML sign-in page, a 404 body, a truncated download). */
export class IcsParseError extends Error {
  constructor(detail: string) {
    super(`Not an iCalendar file: ${detail}`);
    this.name = 'IcsParseError';
  }
}

export function stripByteOrderMark(text: string): string {
  return text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text;
}

export function isIcsText(text: string): boolean {
  return /^\s*BEGIN:VCALENDAR/i.test(stripByteOrderMark(text));
}

/** Local midnight `offset` days from `day`'s date; built from fields, so DST never shifts it. */
export function localMidnight(day: Date, offset: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + offset);
}

/** "today" (also anything unknown), "tomorrow", or "days" = today plus the next days-1. */
export function calendarWindow(range: string, days: number, now: Date): CalendarWindow {
  if (range === 'tomorrow') return { start: localMidnight(now, 1), end: localMidnight(now, 2) };
  if (range === 'days') {
    const span = Math.min(MAX_CALENDAR_DAYS, Math.max(1, Math.floor(days) || DEFAULT_CALENDAR_DAYS));
    return { start: localMidnight(now, 0), end: localMidnight(now, span) };
  }
  return { start: localMidnight(now, 0), end: localMidnight(now, 1) };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function localDateLabel(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localTimeLabel(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return localDateLabel(a) === localDateLabel(b);
}

/** The last day an all-day event covers (its end is the exclusive midnight after it). */
function lastDayOf(event: CalendarEvent): Date {
  const last = localMidnight(event.end, -1);
  return last < event.start ? event.start : last;
}

/** What one loop item carries: strings only, local time, `allDay` "1"/"0" like other flags. */
export interface CalendarEventRecord {
  title: string;
  link: string;
  start: string;
  end: string;
  allDay: string;
  location: string;
}

export function toEventRecord(event: CalendarEvent, untitled: string): CalendarEventRecord {
  const stamp = (date: Date): string => `${localDateLabel(date)} ${localTimeLabel(date)}`;
  return {
    title: event.title || untitled,
    link: event.link,
    start: event.allDay ? localDateLabel(event.start) : stamp(event.start),
    end: event.allDay ? localDateLabel(lastDayOf(event)) : stamp(event.end),
    allDay: event.allDay ? '1' : '0',
    location: event.location,
  };
}

export interface EventLineLabels {
  allDay: string;
  untitled: string;
}

/**
 * One readable line: "09:00–10:00 Title @ Location". A one-day window leaves its own date out
 * and dates only a time on another day (an event spanning midnight); a longer window opens each
 * line with the event's start date.
 */
export function formatEventLine(event: CalendarEvent, window: CalendarWindow, labels: EventLineLabels): string {
  const oneDay = localMidnight(window.start, 1).getTime() >= window.end.getTime();
  const anchor = oneDay ? window.start : event.start;
  const at = (date: Date): string => (sameLocalDay(date, anchor) ? localTimeLabel(date) : `${localDateLabel(date)} ${localTimeLabel(date)}`);
  const last = lastDayOf(event);
  const spansDays = event.allDay && !sameLocalDay(event.start, last);
  let when: string;
  if (event.allDay) {
    when = spansDays ? `${labels.allDay} ${localDateLabel(event.start)}–${localDateLabel(last)}` : labels.allDay;
  } else {
    when = event.end.getTime() > event.start.getTime() ? `${at(event.start)}–${at(event.end)}` : at(event.start);
  }
  const prefix = oneDay || spansDays ? '' : `${localDateLabel(event.start)} `;
  const place = event.location ? ` @ ${event.location}` : '';
  return `${prefix}${when} ${event.title || labels.untitled}${place}`;
}
