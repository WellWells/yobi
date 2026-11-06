import ICAL from 'ical.js';
import { localMidnight } from './calendarFormat';
import { toJsDate } from './icsEvents';

/**
 * The iCalendar text Yobi writes to a CalDAV server. A new event is one plain VEVENT: timed ones in
 * UTC (`Z`, valid without a VTIMEZONE and shown in local time by every client), all-day ones as
 * DATE values with the exclusive DTEND (the day after the last). A change keeps every property it
 * does not touch (alarms, URL, categories …) and bumps SEQUENCE.
 *
 * Repeating events and meetings are refused, not edited: "delete tomorrow's meeting" must not
 * remove a whole series, and changing an invitation would answer or notify other people.
 */

const PRODID = '-//Yobi//Calendar//EN';

export interface EventTimes {
  /** Timed: the instant. All-day: local midnight of the first day. */
  start: Date;
  /** Timed: the instant (exclusive). All-day: local midnight after the last day. */
  end: Date;
  allDay: boolean;
}

export interface EventFields extends EventTimes {
  title: string;
  location?: string;
  description?: string;
}

export type EditRefusal = 'recurring' | 'invited' | 'unreadable';

export interface InspectedEvent {
  uid: string;
  title: string;
  times: EventTimes | null;
  location: string;
  description: string;
  refused?: EditRefusal;
}

function timeValue(date: Date, allDay: boolean): ICAL.Time {
  if (allDay) return ICAL.Time.fromData({ year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), isDate: true });
  return ICAL.Time.fromJSDate(date, true);
}

function setText(event: ICAL.Component, name: string, value: string | undefined): void {
  if (value === undefined) return;
  event.removeAllProperties(name);
  if (value.trim()) event.addPropertyWithValue(name, value);
}

function setTimes(event: ICAL.Component, times: EventTimes): void {
  event.removeAllProperties('dtstart');
  event.removeAllProperties('dtend');
  event.removeAllProperties('duration');
  event.addPropertyWithValue('dtstart', timeValue(times.start, times.allDay));
  event.addPropertyWithValue('dtend', timeValue(times.end, times.allDay));
}

function stamp(event: ICAL.Component, now: Date): void {
  event.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(now, true));
  event.updatePropertyWithValue('last-modified', ICAL.Time.fromJSDate(now, true));
}

export function buildEventIcs(fields: EventFields, uid: string, now: Date): string {
  const calendar = new ICAL.Component(['vcalendar', [], []]);
  calendar.updatePropertyWithValue('prodid', PRODID);
  calendar.updatePropertyWithValue('version', '2.0');
  const event = new ICAL.Component('vevent');
  event.updatePropertyWithValue('uid', uid);
  event.updatePropertyWithValue('created', ICAL.Time.fromJSDate(now, true));
  stamp(event, now);
  setTimes(event, fields);
  setText(event, 'summary', fields.title);
  setText(event, 'location', fields.location);
  setText(event, 'description', fields.description);
  calendar.addSubcomponent(event);
  return calendar.toString();
}

function parseCalendar(ics: string): ICAL.Component | null {
  try {
    const component = new ICAL.Component(ICAL.parse(ics.replace(/^﻿/, '')));
    return component.name === 'vcalendar' ? component : null;
  } catch {
    return null;
  }
}

function text(event: ICAL.Component, name: string): string {
  const value = event.getFirstPropertyValue(name);
  return typeof value === 'string' ? value : '';
}

function tzid(event: ICAL.Component, name: string): string {
  const value = event.getFirstProperty(name)?.getParameter('tzid');
  return typeof value === 'string' ? value : '';
}

function timesOf(event: ICAL.Component): EventTimes | null {
  if (!event.getFirstProperty('dtstart')) return null;
  const item = new ICAL.Event(event);
  const start = toJsDate(item.startDate, tzid(event, 'dtstart'));
  const allDay = item.startDate.isDate;
  const end = item.endDate ? toJsDate(item.endDate, tzid(event, 'dtend') || tzid(event, 'dtstart')) : allDay ? localMidnight(start, 1) : start;
  return { start, end: end < start ? start : end, allDay };
}

/** What an edit would change, and why it may not. Only a single plain VEVENT may be changed. */
export function inspectEventIcs(ics: string): InspectedEvent {
  const calendar = parseCalendar(ics);
  const events = calendar?.getAllSubcomponents('vevent') ?? [];
  const first = events[0];
  if (!calendar || !first) return { uid: '', title: '', times: null, location: '', description: '', refused: 'unreadable' };
  const base: InspectedEvent = {
    uid: text(first, 'uid'),
    title: text(first, 'summary'),
    times: timesOf(first),
    location: text(first, 'location'),
    description: text(first, 'description'),
  };
  const recurring = events.length > 1
    || events.some((event) => ['rrule', 'rdate', 'exdate', 'recurrence-id'].some((name) => event.getFirstProperty(name)));
  if (recurring) return { ...base, refused: 'recurring' };
  if (events.some((event) => event.getAllProperties('attendee').length > 0)) return { ...base, refused: 'invited' };
  if (!base.times) return { ...base, refused: 'unreadable' };
  return base;
}

export interface EventChanges {
  title?: string;
  location?: string;
  description?: string;
  times?: EventTimes;
}

/** The resource with the changes applied; null when `inspectEventIcs` would refuse it. */
export function applyEventChanges(ics: string, changes: EventChanges, now: Date): string | null {
  if (inspectEventIcs(ics).refused) return null;
  const calendar = parseCalendar(ics);
  const event = calendar?.getFirstSubcomponent('vevent');
  if (!calendar || !event) return null;
  setText(event, 'summary', changes.title);
  setText(event, 'location', changes.location);
  setText(event, 'description', changes.description);
  if (changes.times) setTimes(event, changes.times);
  const sequence = Number(event.getFirstPropertyValue('sequence') ?? 0);
  event.updatePropertyWithValue('sequence', Number.isFinite(sequence) ? sequence + 1 : 1);
  stamp(event, now);
  return calendar.toString();
}
