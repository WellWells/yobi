/**
 * Calendar subscriptions (an .ics address per calendar). The address is a secret — Google's
 * "secret address in iCal format" reads the whole calendar — so it lives encrypted in its own
 * store and never crosses to the renderer or into a flow: steps name a calendar by id or name.
 */

/** What Settings and the step editor see of one subscription. */
export interface CalendarSummary {
  id: string;
  name: string;
  /** The address's host ("calendar.google.com"), enough to tell feeds apart without the secret. */
  host: string;
  /** The stored address can no longer be decrypted; it has to be entered again. */
  unreadable: boolean;
}

export interface CalendarSaveRequest {
  /** Absent for a new calendar. */
  id?: string;
  name: string;
  /** Blank when editing keeps the stored address. */
  url: string;
}

export type CalendarSaveError = 'name' | 'duplicate' | 'url' | 'missing';

export type CalendarSaveResult =
  | { ok: true; id: string; calendars: CalendarSummary[] }
  | { ok: false; error: CalendarSaveError };

export interface CalendarTestRequest {
  /** A stored calendar, read with its saved address when `url` is blank. */
  id?: string;
  url: string;
}

export type CalendarTestResult =
  | { ok: true; count: number; days: number }
  | { ok: false; error: string };

/** The longest name a calendar may have; a name is what a flow step and the AI refer to. */
export const CALENDAR_NAME_MAX = 60;

export const CALENDAR_STEP_RANGES = ['today', 'tomorrow', 'days'] as const;
export type CalendarStepRange = typeof CALENDAR_STEP_RANGES[number];

export const DEFAULT_CALENDAR_MAX_EVENTS = 20;
export const MAX_CALENDAR_MAX_EVENTS = 100;

/**
 * The address a person pastes, made fetchable: `webcal://` (what Apple and Outlook hand out) is
 * plain HTTPS. Anything that is not http(s) after that is refused ('').
 */
export function normalizeCalendarUrl(raw: string): string {
  const trimmed = raw.trim().replace(/^webcals?:\/\//i, 'https://');
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch {
    return '';
  }
}

/** Names compare the way a person types them: width-folded, case-blind, trimmed. */
export function calendarNameKey(name: string): string {
  return name.normalize('NFKC').trim().toLowerCase();
}
