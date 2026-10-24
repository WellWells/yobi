import ICAL from 'ical.js';
import { IcsParseError, isIcsText, stripByteOrderMark } from './calendarFormat';
import type { CalendarEvent, CalendarWindow } from './calendarFormat';

/**
 * Occurrences one recurring event may generate. Expansion always starts at the event's first
 * DTSTART, so a daily event from 30 years ago needs ~11,000 steps to reach today; a minutely or
 * secondly rule (or a hostile file) would otherwise spin the main process.
 */
export const MAX_ITERATIONS_PER_EVENT = 20_000;

/** The same guard for the whole file: thousands of recurring events add up. */
export const MAX_ITERATIONS_PER_FILE = 200_000;

function zoneOffsetMs(utcMs: number, tzid: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tzid,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const field = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(field('year'), field('month') - 1, field('day'), field('hour'), field('minute'), field('second'));
  return asUtc - Math.floor(utcMs / 1_000) * 1_000;
}

function isKnownTimeZone(tzid: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tzid });
    return true;
  } catch {
    return false;
  }
}

/**
 * A wall-clock time in an IANA zone the file named but did not define (no VTIMEZONE): the
 * offset is read at the guess and once more at the result, which settles across a DST change.
 */
function wallClockInZone(time: ICAL.Time, tzid: string): Date {
  const guess = Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);
  const first = guess - zoneOffsetMs(guess, tzid);
  return new Date(guess - zoneOffsetMs(first, tzid));
}

/**
 * Absolute time of an ical.js value. A DATE is local midnight; UTC and VTIMEZONE-backed times
 * carry their own offset; a TZID the file never defined is looked up by name; a floating time
 * (no zone at all) is this computer's wall clock.
 */
export function toJsDate(time: ICAL.Time, tzidHint: string): Date {
  if (time.isDate) return new Date(time.year, time.month - 1, time.day);
  const zone = time.zone;
  if (zone && zone !== ICAL.Timezone.localTimezone && zone.tzid !== 'floating') {
    return new Date(time.toUnixTime() * 1_000);
  }
  if (tzidHint && isKnownTimeZone(tzidHint)) return wallClockInZone(time, tzidHint);
  return new Date(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);
}

function tzidOf(component: ICAL.Component, name: string): string {
  const value = component.getFirstProperty(name)?.getParameter('tzid');
  return typeof value === 'string' ? value : '';
}

function textOf(component: ICAL.Component, name: string): string {
  const value = component.getFirstPropertyValue(name);
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function isCancelled(component: ICAL.Component): boolean {
  return textOf(component, 'status').toUpperCase() === 'CANCELLED';
}

function overlaps(event: CalendarEvent, window: CalendarWindow): boolean {
  // A zero-length event (end == start) is a moment: it belongs to the window it falls in.
  if (event.end.getTime() <= event.start.getTime()) return event.start >= window.start && event.start < window.end;
  return event.start < window.end && event.end > window.start;
}

function eventFrom(item: ICAL.Event, startTime: ICAL.Time, endTime: ICAL.Time): CalendarEvent {
  const component = item.component;
  const start = toJsDate(startTime, tzidOf(component, 'dtstart'));
  const end = toJsDate(endTime, tzidOf(component, 'dtend') || tzidOf(component, 'dtstart'));
  return {
    title: textOf(component, 'summary'),
    link: textOf(component, 'url'),
    location: textOf(component, 'location'),
    start,
    end: end < start ? start : end,
    allDay: startTime.isDate,
  };
}

function calendarsIn(ics: string): ICAL.Component[] {
  let jcal: unknown;
  try {
    jcal = ICAL.parse(ics);
  } catch (err) {
    throw new IcsParseError(err instanceof Error ? err.message : String(err));
  }
  if (!Array.isArray(jcal) || jcal.length === 0) throw new IcsParseError('empty document');
  const roots = (Array.isArray(jcal[0]) ? jcal : [jcal]) as unknown[][];
  const calendars = roots.map((root) => new ICAL.Component(root)).filter((component) => component.name === 'vcalendar');
  if (calendars.length === 0) throw new IcsParseError('no VCALENDAR');
  return calendars;
}

interface Budget {
  left: number;
}

function pushIfInWindow(event: CalendarEvent, window: CalendarWindow, out: CalendarEvent[]): void {
  if (overlaps(event, window)) out.push(event);
}

function expandMaster(
  master: ICAL.Event,
  exceptions: ICAL.Event[],
  window: CalendarWindow,
  budget: Budget,
  out: CalendarEvent[],
): void {
  if (isCancelled(master.component)) return;
  if (!master.isRecurring()) {
    pushIfInWindow(eventFrom(master, master.startDate, master.endDate), window, out);
    return;
  }
  for (const exception of exceptions) master.relateException(exception);
  const startHint = tzidOf(master.component, 'dtstart');
  const seen = new Set<ICAL.Event>();
  const iterator = master.iterator();
  for (let steps = 0; steps < MAX_ITERATIONS_PER_EVENT && budget.left > 0; steps += 1) {
    const occurrence = iterator.next();
    if (!occurrence) break;
    budget.left -= 1;
    if (toJsDate(occurrence, startHint) >= window.end) break;
    const details = master.getOccurrenceDetails(occurrence);
    const item = details.item ?? master;
    if (item !== master) seen.add(item);
    if (isCancelled(item.component)) continue;
    pushIfInWindow(eventFrom(item, details.startDate, details.endDate), window, out);
  }
  // An instance moved here from past the point expansion stopped (or one the rule never
  // generates) still stands on its own RECURRENCE-ID entry.
  for (const exception of exceptions) {
    if (seen.has(exception) || isCancelled(exception.component)) continue;
    pushIfInWindow(eventFrom(exception, exception.startDate, exception.endDate), window, out);
  }
}

/**
 * Every occurrence that overlaps the window, sorted by start (all-day before timed at the same
 * moment). RRULE/RDATE/EXDATE expand through ical.js, RECURRENCE-ID entries replace the
 * instance they name, and STATUS:CANCELLED events and instances are left out.
 */
export function readIcsEvents(ics: string, window: CalendarWindow): CalendarEvent[] {
  if (!isIcsText(ics)) throw new IcsParseError('missing BEGIN:VCALENDAR');
  const out: CalendarEvent[] = [];
  const budget: Budget = { left: MAX_ITERATIONS_PER_FILE };
  for (const calendar of calendarsIn(stripByteOrderMark(ics))) {
    const masters = new Map<string, ICAL.Event[]>();
    const exceptions = new Map<string, ICAL.Event[]>();
    const anonymous: ICAL.Event[] = [];
    for (const component of calendar.getAllSubcomponents('vevent')) {
      if (!component.getFirstProperty('dtstart')) continue;
      const event = new ICAL.Event(component);
      const uid = event.uid ?? '';
      if (!uid) {
        anonymous.push(event);
        continue;
      }
      const bucket = event.isRecurrenceException() ? exceptions : masters;
      bucket.set(uid, [...(bucket.get(uid) ?? []), event]);
    }
    for (const [uid, list] of masters) {
      // Exceptions belong to the first master of a UID; a duplicate master stands alone.
      list.forEach((master, index) => expandMaster(master, index === 0 ? exceptions.get(uid) ?? [] : [], window, budget, out));
    }
    for (const [uid, list] of exceptions) {
      if (masters.has(uid)) continue;
      for (const orphan of list) {
        if (!isCancelled(orphan.component)) pushIfInWindow(eventFrom(orphan, orphan.startDate, orphan.endDate), window, out);
      }
    }
    for (const event of anonymous) expandMaster(event, [], window, budget, out);
  }
  return out.sort((a, b) => (a.start.getTime() - b.start.getTime()) || (Number(b.allDay) - Number(a.allDay)));
}
