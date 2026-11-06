import { FlowUserError } from '../flow/userError';
import type { DavClient } from './caldav/davClient';
import { calendarFailure } from './calendarEvents';
import type { CalendarEventRead } from './calendarEvents';
import { localMidnight } from './calendarFormat';
import type { CalendarWindow } from './calendarFormat';
import type { CalendarLookup, ResolvedCalendar } from './calendarStore';
import { applyEventChanges, buildEventIcs, inspectEventIcs } from './eventIcs';
import type { EditRefusal, EventTimes } from './eventIcs';
import { CalendarArgumentError, MAX_READ_SPAN_DAYS, eventTimesFrom, formatTimes, parseWhen } from './eventTime';

/**
 * What the Calendar connector's tools do: list the calendars, read a window of events (every kind
 * of calendar), and add, change or delete one event on a CalDAV calendar the account may write.
 */

export interface CalendarServiceDeps {
  find: (ref: string) => CalendarLookup;
  read: (calendar: ResolvedCalendar, window: CalendarWindow, signal?: AbortSignal) => Promise<CalendarEventRead[]>;
  dav: (accountId: string) => DavClient;
  /** Reads the calendar lists that are due again (before every tool); names the accounts whose list may be out of date. */
  freshen: () => Promise<string[]>;
  now: () => Date;
  newUid: () => string;
}

export const EVENTS_LIMIT_DEFAULT = 50;
export const EVENTS_LIMIT_MAX = 100;
const DESCRIPTION_MAX_CHARS = 300;
const DEFAULT_READ_DAYS = 7;

export interface EventArgs {
  title?: string;
  start?: string;
  end?: string;
  all_day?: boolean;
  location?: string;
  description?: string;
}

/** `<calendar id>~<resource name>`: the calendar says where, the name which resource. */
export function eventIdOf(calendarId: string, resourceUrl: string): string {
  const name = new URL(resourceUrl).pathname.split('/').filter(Boolean).pop() ?? '';
  return `${calendarId}~${name}`;
}

function splitEventId(eventId: string): { calendarId: string; name: string } {
  const at = eventId.indexOf('~');
  const calendarId = at < 0 ? '' : eventId.slice(0, at);
  const name = at < 0 ? '' : eventId.slice(at + 1);
  if (!calendarId || !name || name.includes('/')) throw new CalendarArgumentError('event_id must be one calendar_events returned');
  return { calendarId, name };
}

/**
 * The resource inside the calendar's own collection, and nowhere else: the URL parser reads "\" as
 * "/" and ".." as up, so the name is checked again after resolving, against the collection's origin
 * and path (a request carries the account's password).
 */
function resourceUrl(calendar: ResolvedCalendar, name: string): string {
  const base = new URL(calendar.url.endsWith('/') ? calendar.url : `${calendar.url}/`);
  const invalid = new CalendarArgumentError('event_id must be one calendar_events returned');
  if (/[\\?#]|^\.\.?$|%2f|%5c/i.test(name)) throw invalid;
  const url = new URL(name, base);
  const rest = url.pathname.slice(base.pathname.length);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || !rest || rest.includes('/')) throw invalid;
  return url.toString();
}

function allCalendars(find: CalendarServiceDeps['find']): ResolvedCalendar[] {
  const lookup = find('');
  return lookup.kind === 'found' ? lookup.calendars : [];
}

function refusalError(refused: EditRefusal): CalendarArgumentError {
  if (refused === 'recurring') return new CalendarArgumentError('This is a repeating event. Yobi does not change or delete repeating events; tell the user to change it in their calendar app.');
  if (refused === 'invited') return new CalendarArgumentError('This event has invited people. Yobi does not change or delete meetings (it would answer or notify them); tell the user to change it in their calendar app.');
  return new CalendarArgumentError('The event on the server could not be read');
}

export function createCalendarService(deps: CalendarServiceDeps) {
  function lookup(ref: string): ResolvedCalendar[] {
    const found = deps.find(ref);
    if (found.kind === 'none') throw new FlowUserError('flow.error.calendarNone', {}, 'No calendar has been added in Settings yet');
    if (found.kind === 'unknown') throw new CalendarArgumentError(`No calendar called "${ref}"; calendar_list names them`);
    if (found.kind === 'ambiguous') throw new CalendarArgumentError(`Several accounts have a calendar called "${ref}"; use its id from calendar_list`);
    return found.calendars;
  }

  function writableCalendar(ref: string | undefined): Extract<ResolvedCalendar, { kind: 'caldav' }> {
    const writable = allCalendars(deps.find).filter((item): item is Extract<ResolvedCalendar, { kind: 'caldav' }> => item.kind === 'caldav' && item.writable);
    if (!ref?.trim()) {
      if (writable.length === 1) return writable[0];
      if (writable.length === 0) throw new CalendarArgumentError('No calendar can be written to: add a CalDAV account (iCloud, Fastmail, Nextcloud …) in Settings › Connectors › Calendars. Subscribed .ics calendars are read only.');
      throw new CalendarArgumentError(`Several calendars can be written to (${writable.map((item) => `"${item.name}"`).join(', ')}); name one in "calendar" (ask the user which).`);
    }
    const [calendar] = lookup(ref);
    if (calendar.kind !== 'caldav' || !calendar.writable) throw new CalendarArgumentError(`Calendar "${calendar.name}" is read only`);
    return calendar;
  }

  function calendarOfEvent(eventId: string): { calendar: Extract<ResolvedCalendar, { kind: 'caldav' }>; url: string } {
    const { calendarId, name } = splitEventId(eventId);
    const calendar = allCalendars(deps.find).find((item) => item.id === calendarId);
    if (!calendar) throw new CalendarArgumentError('The calendar of this event_id is no longer set up; read the events again');
    if (calendar.kind !== 'caldav' || !calendar.writable) throw new CalendarArgumentError(`Calendar "${calendar.name}" is read only`);
    return { calendar, url: resourceUrl(calendar, name) };
  }

  async function list(): Promise<unknown> {
    const failed = await deps.freshen();
    return {
      calendars: allCalendars(deps.find).map((item) => ({
        calendar: item.name,
        id: item.id,
        ...(item.kind === 'caldav' ? { account: item.account } : {}),
        writable: item.kind === 'caldav' && item.writable,
      })),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...(failed.length > 0 ? { note: `Could not refresh: ${failed.join(', ')} (their last known calendars are listed)` } : {}),
    };
  }

  function readWindow(from: string | undefined, to: string | undefined): CalendarWindow {
    const start = from ? parseWhen(from, 'from') : { date: localMidnight(deps.now(), 0), dateOnly: true };
    const startAt = start.dateOnly ? localMidnight(start.date, 0) : start.date;
    let end: Date;
    if (to) {
      const parsed = parseWhen(to, 'to');
      end = parsed.dateOnly ? localMidnight(parsed.date, 1) : parsed.date;
    } else {
      end = localMidnight(startAt, from ? 1 : DEFAULT_READ_DAYS);
    }
    if (end <= startAt) throw new CalendarArgumentError('to must be after from');
    if (end.getTime() - startAt.getTime() > MAX_READ_SPAN_DAYS * 86_400_000) throw new CalendarArgumentError(`Read at most ${MAX_READ_SPAN_DAYS} days at a time`);
    return { start: startAt, end };
  }

  async function events(args: { from?: string; to?: string; calendar?: string; query?: string; limit?: number }, signal?: AbortSignal): Promise<unknown> {
    const window = readWindow(args.from, args.to);
    await deps.freshen();
    const calendars = args.calendar?.trim() ? lookup(args.calendar) : lookup('');
    const failed: { calendar: string; error: string }[] = [];
    const found: CalendarEventRead[] = [];
    // Side by side: each calendar is its own request, and a slow one should not hold up the rest.
    const results = await Promise.allSettled(calendars.map((calendar) => deps.read(calendar, window, signal)));
    if (signal?.aborted) throw signal.reason ?? new Error('aborted');
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') found.push(...result.value);
      else failed.push({ calendar: calendars[index].name, error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
    });
    if (failed.length === calendars.length && failed.length > 0) throw new Error(`No calendar could be read: ${failed.map((item) => `${item.calendar} (${item.error})`).join('; ')}`);
    const words = (args.query ?? '').trim().toLowerCase();
    const matching = found
      .filter((event) => !words || [event.title, event.location, event.description ?? ''].some((text) => text.toLowerCase().includes(words)))
      .sort((a, b) => (a.start.getTime() - b.start.getTime()) || (Number(b.allDay) - Number(a.allDay)));
    const limit = Math.min(EVENTS_LIMIT_MAX, Math.max(1, Math.floor(args.limit ?? EVENTS_LIMIT_DEFAULT)));
    const shown = matching.slice(0, limit);
    return {
      from: formatTimes({ start: window.start, end: window.end, allDay: false }).start,
      to: formatTimes({ start: window.start, end: window.end, allDay: false }).end,
      total: matching.length,
      events: shown.map((event) => ({
        ...(event.resource ? { event_id: eventIdOf(event.calendarId, event.resource.url) } : {}),
        calendar: event.calendarName,
        title: event.title,
        ...formatTimes(event),
        ...(event.location ? { location: event.location } : {}),
        ...(event.description ? { description: event.description.slice(0, DESCRIPTION_MAX_CHARS) } : {}),
        ...(event.recurring ? { repeating: true } : {}),
        ...(event.invited ? { meeting: true } : {}),
      })),
      ...(matching.length > shown.length ? { truncated: `Listed ${shown.length} of ${matching.length}; narrow the dates or the query before summing anything up` } : {}),
      ...(failed.length > 0 ? { failed } : {}),
    };
  }

  async function create(args: EventArgs & { calendar?: string }, signal?: AbortSignal): Promise<unknown> {
    const title = (args.title ?? '').trim();
    if (!title) throw new CalendarArgumentError('title is required');
    await deps.freshen();
    const calendar = writableCalendar(args.calendar);
    const times = eventTimesFrom({ start: args.start, end: args.end, allDay: args.all_day });
    const uid = deps.newUid();
    const ics = buildEventIcs({ ...times, title, location: args.location, description: args.description }, uid, deps.now());
    try {
      const { url } = await deps.dav(calendar.accountId).createResource(calendar.url, `${uid}.ics`, ics, signal);
      return { event_id: eventIdOf(calendar.id, url), calendar: calendar.name, title, ...formatTimes(times), ...(args.location ? { location: args.location } : {}) };
    } catch (err) {
      throw calendarFailure(err, calendar.name);
    }
  }

  async function update(args: EventArgs & { event_id?: string }, signal?: AbortSignal): Promise<unknown> {
    await deps.freshen();
    const { calendar, url } = calendarOfEvent(args.event_id ?? '');
    try {
      const client = deps.dav(calendar.accountId);
      const resource = await client.getResource(url, signal);
      const current = inspectEventIcs(resource.ics);
      if (current.refused) throw refusalError(current.refused);
      const timesGiven = args.start !== undefined || args.end !== undefined || args.all_day !== undefined;
      const times: EventTimes | undefined = timesGiven
        ? eventTimesFrom({ start: args.start, end: args.end, allDay: args.all_day }, current.times ?? undefined)
        : undefined;
      if (!timesGiven && args.title === undefined && args.location === undefined && args.description === undefined) {
        throw new CalendarArgumentError('Nothing to change: give title, start, end, all_day, location or description');
      }
      if (args.title !== undefined && !args.title.trim()) throw new CalendarArgumentError('title cannot be empty');
      const changed = applyEventChanges(resource.ics, { title: args.title?.trim(), location: args.location, description: args.description, ...(times ? { times } : {}) }, deps.now());
      if (!changed) throw refusalError('unreadable');
      await client.updateResource(url, changed, resource.etag, signal);
      const final = times ?? current.times;
      return {
        event_id: args.event_id,
        calendar: calendar.name,
        title: args.title?.trim() ?? current.title,
        ...(final ? formatTimes(final) : {}),
        updated: true,
      };
    } catch (err) {
      throw calendarFailure(err, calendar.name);
    }
  }

  async function remove(args: { event_id?: string }, signal?: AbortSignal): Promise<unknown> {
    await deps.freshen();
    const { calendar, url } = calendarOfEvent(args.event_id ?? '');
    try {
      const client = deps.dav(calendar.accountId);
      const resource = await client.getResource(url, signal);
      const current = inspectEventIcs(resource.ics);
      if (current.refused) throw refusalError(current.refused);
      await client.deleteResource(url, resource.etag, signal);
      return { deleted: true, calendar: calendar.name, title: current.title, ...(current.times ? formatTimes(current.times) : {}) };
    } catch (err) {
      throw calendarFailure(err, calendar.name);
    }
  }

  return { list, events, create, update, remove };
}

export type CalendarService = ReturnType<typeof createCalendarService>;
