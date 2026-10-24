import { fetchRawResponse } from '../pageLoader';
import { userAgentForUrl } from '../userAgent';
import { FlowUserError } from '../flow/userError';
import { normalizeCalendarUrl } from '../../shared/calendars';
import { IcsParseError, isIcsText } from './calendarFormat';
import type { CalendarEvent, CalendarWindow } from './calendarFormat';

/**
 * Reads one .ics feed. The address is a secret, so nothing here logs it or puts it in an error:
 * the step names the calendar instead. `fetchRawResponse` carries the timeout, the size cap and
 * the bot-run public-web-only check.
 */
export async function fetchIcs(rawUrl: string, signal?: AbortSignal): Promise<string> {
  const url = normalizeCalendarUrl(rawUrl);
  if (!url) throw new FlowUserError('flow.error.calendarAddress', {}, 'The saved calendar address is not an http(s) link');
  const { status, text } = await fetchRawResponse(url, {
    headers: { 'User-Agent': userAgentForUrl(url), Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.8' },
    ...(signal ? { signal } : {}),
  });
  if (status >= 400) {
    throw new FlowUserError('flow.error.calendarHttp', { status: String(status) }, `The calendar feed answered HTTP ${status}`);
  }
  if (!isIcsText(text)) {
    throw new FlowUserError('flow.error.calendarNotIcs', {}, 'The calendar address did not return an iCalendar (.ics) file');
  }
  return text;
}

/** The parser loads ical.js on first use, so the module stays off the boot path. */
export async function readFeedEvents(ics: string, window: CalendarWindow): Promise<CalendarEvent[]> {
  const { readIcsEvents } = await import('./icsEvents');
  try {
    return readIcsEvents(ics, window);
  } catch (err) {
    if (err instanceof IcsParseError) {
      throw new FlowUserError('flow.error.calendarNotIcs', {}, 'The calendar address did not return an iCalendar (.ics) file');
    }
    throw err;
  }
}
