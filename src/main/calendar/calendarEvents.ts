import { FlowUserError } from '../flow/userError';
import { DavError } from './caldav/davClient';
import type { DavClient } from './caldav/davClient';
import { davClientFor } from './calDavAccounts';
import { fetchIcs, readFeedEvents } from './calendarFetch';
import type { CalendarEvent, CalendarWindow } from './calendarFormat';
import type { ResolvedCalendar } from './calendarStore';

/**
 * Events of one calendar in a window, whatever kind it is: an .ics feed read whole, or a CalDAV
 * calendar asked for the window (the server picks the resources, ical.js expands them here).
 */

export interface CalendarEventRead extends CalendarEvent {
  calendarId: string;
  calendarName: string;
  /** CalDAV only: the resource that holds the event and the version that was read. */
  resource?: { url: string; etag: string };
}

export interface CalendarReadDeps {
  fetchIcs: (url: string, signal?: AbortSignal) => Promise<string>;
  readIcs: (ics: string, window: CalendarWindow) => Promise<CalendarEvent[]>;
  davClient: (accountId: string) => DavClient;
}

export const DEFAULT_READ_DEPS: CalendarReadDeps = {
  fetchIcs,
  readIcs: readFeedEvents,
  davClient: (accountId) => davClientFor(accountId),
};

/** A CalDAV failure in the user's words, naming the calendar (never its address or account). */
export function calendarFailure(err: unknown, name: string): unknown {
  if (!(err instanceof DavError)) return err;
  switch (err.kind) {
    case 'auth':
      return new FlowUserError('flow.error.calendarSignIn', { name }, `The calendar server refused the sign-in for "${name}"; check the account in Settings`);
    case 'unreachable': case 'tls':
      return new FlowUserError('flow.error.calendarUnreachable', { name }, `The server of calendar "${name}" did not answer (${err.message})`);
    case 'notFound':
      return new FlowUserError('flow.error.calendarGone', { name }, `Calendar "${name}" is no longer on its server; refresh the account in Settings`);
    case 'conflict':
      return new FlowUserError('flow.error.calendarChanged', { name }, 'The event was changed elsewhere since it was read; read it again first');
    case 'forbidden':
      return new FlowUserError('flow.error.calendarReadOnly', { name }, `Calendar "${name}" does not allow this account to change it`);
    default:
      return new FlowUserError('flow.error.calendarHttp', { status: String(err.status || '?') }, err.message);
  }
}

export async function readCalendarEvents(
  calendar: ResolvedCalendar,
  window: CalendarWindow,
  signal?: AbortSignal,
  deps: CalendarReadDeps = DEFAULT_READ_DEPS,
): Promise<CalendarEventRead[]> {
  const tag = { calendarId: calendar.id, calendarName: calendar.name };
  if (calendar.kind === 'ics') {
    if (calendar.unreadable) {
      throw new FlowUserError(
        'flow.error.calendarUnreadable',
        { name: calendar.name },
        `The saved address of calendar "${calendar.name}" cannot be read; enter it again in Settings`,
      );
    }
    const events = await deps.readIcs(await deps.fetchIcs(calendar.url, signal), window);
    return events.map((event) => ({ ...event, ...tag }));
  }
  try {
    const resources = await deps.davClient(calendar.accountId).queryEvents(calendar.url, window.start, window.end, signal);
    const out: CalendarEventRead[] = [];
    for (const resource of resources) {
      let events: CalendarEvent[];
      try {
        events = await deps.readIcs(resource.ics, window);
      } catch (err) {
        // One unreadable event does not hide the rest of the day.
        if (err instanceof FlowUserError) continue;
        throw err;
      }
      out.push(...events.map((event) => ({ ...event, ...tag, resource: { url: resource.url, etag: resource.etag } })));
    }
    return out.sort((a, b) => (a.start.getTime() - b.start.getTime()) || (Number(b.allDay) - Number(a.allDay)));
  } catch (err) {
    throw calendarFailure(err, calendar.name);
  }
}

/** Several calendars into one list, by start; any failure fails the whole read (no silent gaps). */
export async function readManyCalendars(
  calendars: ResolvedCalendar[],
  window: CalendarWindow,
  signal?: AbortSignal,
  deps: CalendarReadDeps = DEFAULT_READ_DEPS,
): Promise<CalendarEventRead[]> {
  const lists = await Promise.all(calendars.map((calendar) => readCalendarEvents(calendar, window, signal, deps)));
  return lists.flat().sort((a, b) => (a.start.getTime() - b.start.getTime()) || (Number(b.allDay) - Number(a.allDay)));
}
