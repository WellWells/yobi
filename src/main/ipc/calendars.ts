import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import type {
  CalendarSaveRequest, CalendarSaveResult, CalendarSummary, CalendarTestRequest, CalendarTestResult,
} from '../../shared/calendars';
import { calendarUrl, listCalendars, removeCalendar, saveCalendar } from '../calendar/calendarStore';
import { fetchIcs, readFeedEvents } from '../calendar/calendarFetch';
import { DEFAULT_CALENDAR_DAYS, calendarWindow } from '../calendar/calendarFormat';
import { FlowUserError, localizeStepError } from '../flow/userError';
import { getLangCache } from '../i18n';
import { sendLog } from '../helpers';

/**
 * "Test" reads the feed once and counts what falls in the next week. It answers with the
 * user-facing reason when it fails; the address itself never leaves main.
 */
export async function testCalendar(request: CalendarTestRequest, now: Date = new Date()): Promise<CalendarTestResult> {
  const typed = String(request?.url ?? '').trim();
  const url = typed || (typeof request?.id === 'string' ? calendarUrl(request.id) : '');
  try {
    if (!url) throw new FlowUserError('flow.error.calendarAddress', {}, 'The saved calendar address is not an http(s) link');
    const window = calendarWindow('days', DEFAULT_CALENDAR_DAYS, now);
    const events = await readFeedEvents(await fetchIcs(url), window);
    return { ok: true, count: events.length, days: DEFAULT_CALENDAR_DAYS };
  } catch (err) {
    sendLog(`📅 Calendar test failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, error: localizeStepError(err, getLangCache()) };
  }
}

export function registerCalendarHandlers(): void {
  ipcMain.handle(IPC.CALENDAR_LIST, (): CalendarSummary[] => listCalendars());
  ipcMain.handle(IPC.CALENDAR_SAVE, (_event, request: CalendarSaveRequest): CalendarSaveResult => {
    const result = saveCalendar(request ?? { name: '', url: '' });
    if (result.ok) sendLog(`📅 Calendar ${request?.id ? 'updated' : 'added'}: ${String(request.name).trim()}`);
    return result;
  });
  ipcMain.handle(IPC.CALENDAR_REMOVE, (_event, id: unknown): CalendarSummary[] => removeCalendar(String(id ?? '')));
  ipcMain.handle(IPC.CALENDAR_TEST, (_event, request: CalendarTestRequest): Promise<CalendarTestResult> => testCalendar(request));
}
