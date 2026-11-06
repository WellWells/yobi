import { sendLog } from '../../helpers';
import { getLangCache, t } from '../../i18n';
import { FlowUserError } from '../userError';
import { clampIntField } from './numberField';
import { envelope } from './dataSources';
import { findCalendar } from '../../calendar/calendarStore';
import type { CalendarLookup, ResolvedCalendar } from '../../calendar/calendarStore';
import { readManyCalendars } from '../../calendar/calendarEvents';
import { calendarFreshness } from '../../calendar/calendarFreshness';
import type { CalendarEventRead } from '../../calendar/calendarEvents';
import {
  DEFAULT_CALENDAR_DAYS, MAX_CALENDAR_DAYS, calendarWindow, formatEventLine, localDateLabel, localMidnight, toEventRecord,
} from '../../calendar/calendarFormat';
import type { CalendarWindow } from '../../calendar/calendarFormat';
import { DEFAULT_CALENDAR_MAX_EVENTS, MAX_CALENDAR_MAX_EVENTS } from '../../../shared/calendars';

export interface CalendarStepDeps {
  /** Reads the calendar lists that are due again; names the accounts whose list may be out of date. */
  freshen: () => Promise<string[]>;
  findCalendar: (ref: string) => CalendarLookup;
  readEvents: (calendars: ResolvedCalendar[], window: CalendarWindow, signal?: AbortSignal) => Promise<CalendarEventRead[]>;
  now: () => Date;
  labels: { allDay: string; untitled: string };
  log: (line: string) => void;
}

function resolveOrThrow(lookup: CalendarLookup, ref: string): ResolvedCalendar[] {
  switch (lookup.kind) {
    case 'none':
      throw new FlowUserError('flow.error.calendarNone', {}, 'No calendar has been added in Settings yet');
    case 'ambiguous':
      throw new FlowUserError('flow.error.calendarAmbiguous', { name: ref }, `Several accounts have a calendar called "${ref}"; pick one on the calendar step`);
    case 'unknown':
      throw new FlowUserError('flow.error.calendarUnknown', { name: ref }, `No calendar called "${ref}" is set up`);
    default:
      return lookup.calendars;
  }
}

/**
 * The calendar step: the events that overlap today, tomorrow or the next N days, of one calendar
 * or (field blank) all of them. {{key}} is a JSON array for a loop ("[]" on an empty day, so a stop
 * step ends the flow); .text is one readable line per event for an llm prompt; .count, .calendar,
 * .from, .to.
 */
export async function runCalendarStep(
  config: Record<string, string>,
  deps: CalendarStepDeps,
  signal?: AbortSignal,
): Promise<string> {
  const ref = (config.calendar ?? '').trim();
  // A calendar made on the phone joins "all calendars" without a trip to Settings.
  const outOfDate = await deps.freshen();
  if (outOfDate.length > 0) deps.log(`📅 [Flow] Calendar list not refreshed for ${outOfDate.length} account(s); using the last one`);
  const calendars = resolveOrThrow(deps.findCalendar(ref), ref);
  const days = clampIntField(config.days, DEFAULT_CALENDAR_DAYS, 1, MAX_CALENDAR_DAYS);
  const maxEvents = clampIntField(config.maxEvents, DEFAULT_CALENDAR_MAX_EVENTS, 1, MAX_CALENDAR_MAX_EVENTS);
  const window = calendarWindow((config.range ?? '').trim(), days, deps.now());

  const all = await deps.readEvents(calendars, window, signal);
  const events = all.slice(0, maxEvents);
  const names = calendars.map((calendar) => calendar.name).join(', ');
  deps.log(`📅 [Flow] Calendar "${names}": ${all.length} event(s) from ${localDateLabel(window.start)}${all.length > events.length ? `, kept the first ${events.length}` : ''}`);

  const several = calendars.length > 1;
  return envelope(JSON.stringify(events.map((event) => ({ ...toEventRecord(event, deps.labels.untitled), calendar: event.calendarName }))), {
    text: events.map((event) => `${formatEventLine(event, window, deps.labels)}${several ? ` (${event.calendarName})` : ''}`).join('\n'),
    count: String(events.length),
    calendar: names,
    from: localDateLabel(window.start),
    to: localDateLabel(localMidnight(window.end, -1)),
  });
}

export function execCalendar(config: Record<string, string>, signal?: AbortSignal): Promise<string> {
  const strings = getLangCache();
  return runCalendarStep(config, {
    freshen: () => calendarFreshness().freshen(),
    findCalendar,
    readEvents: (calendars, window, stepSignal) => readManyCalendars(calendars, window, stepSignal),
    now: () => new Date(),
    labels: { allDay: t(strings, 'flow.calendar.allDay'), untitled: t(strings, 'flow.calendar.untitled') },
    log: sendLog,
  }, signal);
}
