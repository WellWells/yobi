import { sendLog } from '../../helpers';
import { getLangCache, t } from '../../i18n';
import { FlowUserError } from '../userError';
import { clampIntField } from './numberField';
import { envelope } from './dataSources';
import { findCalendar } from '../../calendar/calendarStore';
import type { CalendarLookup } from '../../calendar/calendarStore';
import { fetchIcs, readFeedEvents } from '../../calendar/calendarFetch';
import {
  DEFAULT_CALENDAR_DAYS, MAX_CALENDAR_DAYS, calendarWindow, formatEventLine, localDateLabel, localMidnight, toEventRecord,
} from '../../calendar/calendarFormat';
import type { CalendarEvent, CalendarWindow } from '../../calendar/calendarFormat';
import { DEFAULT_CALENDAR_MAX_EVENTS, MAX_CALENDAR_MAX_EVENTS } from '../../../shared/calendars';

export interface CalendarStepDeps {
  findCalendar: (ref: string) => CalendarLookup;
  fetchIcs: (url: string, signal?: AbortSignal) => Promise<string>;
  readEvents: (ics: string, window: CalendarWindow) => Promise<CalendarEvent[]>;
  now: () => Date;
  labels: { allDay: string; untitled: string };
  log: (line: string) => void;
}

function resolveOrThrow(lookup: CalendarLookup, ref: string): { name: string; url: string } {
  switch (lookup.kind) {
    case 'none':
      throw new FlowUserError('flow.error.calendarNone', {}, 'No calendar has been added in Settings yet');
    case 'pick':
      throw new FlowUserError('flow.error.calendarPick', {}, 'Several calendars are set up; pick one on the calendar step');
    case 'unknown':
      throw new FlowUserError('flow.error.calendarUnknown', { name: ref }, `No calendar called "${ref}" is set up`);
    default:
      break;
  }
  const { calendar } = lookup;
  if (calendar.unreadable) {
    throw new FlowUserError(
      'flow.error.calendarUnreadable',
      { name: calendar.name },
      `The saved address of calendar "${calendar.name}" cannot be read; enter it again in Settings`,
    );
  }
  return { name: calendar.name, url: calendar.url };
}

/**
 * The calendar step: the events of one subscribed calendar that overlap today, tomorrow or the
 * next N days. {{key}} is a JSON array for a loop ("[]" on an empty day, so a stop step ends the
 * flow); .text is one readable line per event for an llm prompt; .count, .calendar, .from, .to.
 */
export async function runCalendarStep(
  config: Record<string, string>,
  deps: CalendarStepDeps,
  signal?: AbortSignal,
): Promise<string> {
  const ref = (config.calendar ?? '').trim();
  const { name, url } = resolveOrThrow(deps.findCalendar(ref), ref);
  const days = clampIntField(config.days, DEFAULT_CALENDAR_DAYS, 1, MAX_CALENDAR_DAYS);
  const maxEvents = clampIntField(config.maxEvents, DEFAULT_CALENDAR_MAX_EVENTS, 1, MAX_CALENDAR_MAX_EVENTS);
  const window = calendarWindow((config.range ?? '').trim(), days, deps.now());

  const ics = await deps.fetchIcs(url, signal);
  const all = await deps.readEvents(ics, window);
  const events = all.slice(0, maxEvents);
  deps.log(`📅 [Flow] Calendar "${name}": ${all.length} event(s) from ${localDateLabel(window.start)}${all.length > events.length ? `, kept the first ${events.length}` : ''}`);

  return envelope(JSON.stringify(events.map((event) => toEventRecord(event, deps.labels.untitled))), {
    text: events.map((event) => formatEventLine(event, window, deps.labels)).join('\n'),
    count: String(events.length),
    calendar: name,
    from: localDateLabel(window.start),
    to: localDateLabel(localMidnight(window.end, -1)),
  });
}

export function execCalendar(config: Record<string, string>, signal?: AbortSignal): Promise<string> {
  const strings = getLangCache();
  return runCalendarStep(config, {
    findCalendar,
    fetchIcs,
    readEvents: readFeedEvents,
    now: () => new Date(),
    labels: { allDay: t(strings, 'flow.calendar.allDay'), untitled: t(strings, 'flow.calendar.untitled') },
    log: sendLog,
  }, signal);
}
