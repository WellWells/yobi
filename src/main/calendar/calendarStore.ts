import { randomUUID } from 'node:crypto';
import { decryptToken, decryptTokenChecked, encryptToken } from '../configEncryption';
import { clearSecretFailures, recordSecretFailure } from '../secretHealth';
import { calendarFile } from './calendarFile';
import type { StoredCalendar } from './calendarFile';
import {
  clearAllDavAccounts, clearDavPassword, davAccountUsable, davCalendarEntries, isDavAccountId, probeDavAccounts, reEncryptDavAccounts,
} from './calDavStore';
import { CALENDAR_NAME_MAX, calendarNameKey, normalizeCalendarUrl } from '../../shared/calendars';
import type { CalendarSaveRequest, CalendarSaveResult, CalendarSummary } from '../../shared/calendars';

/**
 * Calendar subscriptions, in their own file next to config.json (like the data-source keys and
 * MCP tokens): the .ics address is encrypted with the OS key, the name and id are not. Flows
 * hold only the id or the name, so an exported or shared flow carries no address. The calendars
 * of CalDAV accounts (`calDavStore.ts`) share the file and join the list every reader sees.
 */

function stored(): StoredCalendar[] {
  const list = calendarFile().store.calendars;
  if (!Array.isArray(list)) return [];
  return list.filter((entry): entry is StoredCalendar => Boolean(entry)
    && typeof entry.id === 'string' && typeof entry.name === 'string' && typeof entry.urlEncrypted === 'string');
}

function write(list: StoredCalendar[]): void {
  calendarFile().set('calendars', list);
}

function decryptUrl(entry: StoredCalendar): { url: string; failed: boolean } {
  const result = decryptTokenChecked(entry.urlEncrypted, `calendar.url (${entry.id})`);
  if (result.failed) recordSecretFailure({ scope: 'calendar', id: entry.id, field: 'url', label: entry.name });
  else clearSecretFailures('calendar', entry.id);
  return { url: result.value, failed: result.failed };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function summaryOf(entry: StoredCalendar): CalendarSummary {
  const { url, failed } = decryptUrl(entry);
  return { id: entry.id, name: entry.name, host: hostOf(url), unreadable: failed || !url, kind: 'ics', account: '', writable: false };
}

/** Subscriptions first, then each CalDAV account's calendars in Settings order. */
export function listCalendars(): CalendarSummary[] {
  return [
    ...stored().map(summaryOf),
    ...davCalendarEntries().map(({ account, calendar }): CalendarSummary => ({
      id: calendar.id,
      name: calendar.name,
      host: hostOf(calendar.url),
      unreadable: !davAccountUsable(account),
      kind: 'caldav',
      account: account.username,
      writable: calendar.writable,
    })),
  ];
}

/** How many calendars there are, without opening an address or a password. */
export function calendarCount(): number {
  return stored().length + davCalendarEntries().length;
}

export type ResolvedCalendar =
  | { kind: 'ics'; id: string; name: string; url: string; unreadable: boolean }
  | { kind: 'caldav'; id: string; name: string; accountId: string; account: string; url: string; writable: boolean; unreadable: false };

export type CalendarLookup =
  /** The one named, or every calendar for a blank field. */
  | { kind: 'found'; calendars: ResolvedCalendar[] }
  | { kind: 'none' }
  /** The name is shared by calendars of different accounts ("Home"); the id tells them apart. */
  | { kind: 'ambiguous' }
  | { kind: 'unknown' };

function resolveIcs(entry: StoredCalendar): ResolvedCalendar {
  const { url, failed } = decryptUrl(entry);
  return { kind: 'ics', id: entry.id, name: entry.name, url, unreadable: failed || !url };
}

function allResolved(): ResolvedCalendar[] {
  return [
    ...stored().map(resolveIcs),
    ...davCalendarEntries().map(({ account, calendar }): ResolvedCalendar => ({
      kind: 'caldav', id: calendar.id, name: calendar.name, accountId: account.id, account: account.username, url: calendar.url, writable: calendar.writable, unreadable: false,
    })),
  ];
}

/**
 * What a step's `calendar` field points at: an id (what the editor stores), else a name as the
 * person or the AI wrote it. Blank reads every calendar there is: a morning summary wants the
 * whole day, and an iCloud account alone brings several calendars.
 */
export function findCalendar(ref: string): CalendarLookup {
  if (calendarCount() === 0) return { kind: 'none' };
  const all = allResolved();
  const wanted = ref.trim();
  if (!wanted) return { kind: 'found', calendars: all };
  const byId = all.find((item) => item.id === wanted);
  if (byId) return { kind: 'found', calendars: [byId] };
  const key = calendarNameKey(wanted);
  const named = all.filter((item) => calendarNameKey(item.name) === key);
  if (named.length === 0) return { kind: 'unknown' };
  // A subscription's name is unique among subscriptions and wins over an account's calendar.
  const icsNamed = named.filter((item) => item.kind === 'ics');
  if (icsNamed.length === 1) return { kind: 'found', calendars: icsNamed };
  return named.length === 1 ? { kind: 'found', calendars: named } : { kind: 'ambiguous' };
}

/** The decrypted address of one stored subscription ('' when unknown or unreadable). */
export function calendarUrl(id: string): string {
  const entry = stored().find((item) => item.id === id);
  return entry ? decryptUrl(entry).url : '';
}

export function saveCalendar(request: CalendarSaveRequest): CalendarSaveResult {
  const name = String(request.name ?? '').trim().slice(0, CALENDAR_NAME_MAX);
  if (!name) return { ok: false, error: 'name' };
  const list = stored();
  const id = typeof request.id === 'string' ? request.id : '';
  const existing = id ? list.find((item) => item.id === id) : undefined;
  if (id && !existing) return { ok: false, error: 'missing' };
  if (list.some((item) => item.id !== id && calendarNameKey(item.name) === calendarNameKey(name))) {
    return { ok: false, error: 'duplicate' };
  }
  const rawUrl = String(request.url ?? '').trim();
  const url = rawUrl ? normalizeCalendarUrl(rawUrl) : '';
  if (rawUrl && !url) return { ok: false, error: 'url' };
  if (!existing && !url) return { ok: false, error: 'url' };

  if (existing) {
    const next = list.map((item) => (item.id === id
      ? { ...item, name, urlEncrypted: url ? encryptToken(url) : item.urlEncrypted }
      : item));
    write(next);
    if (url) clearSecretFailures('calendar', id);
    return { ok: true, id, calendars: listCalendars() };
  }
  const created: StoredCalendar = { id: `cal_${randomUUID().slice(0, 8)}`, name, urlEncrypted: encryptToken(url) };
  write([...list, created]);
  return { ok: true, id: created.id, calendars: listCalendars() };
}

export function removeCalendar(id: string): CalendarSummary[] {
  clearSecretFailures('calendar', id);
  write(stored().filter((item) => item.id !== id));
  return listCalendars();
}

/** Drops an address that can no longer be decrypted; the calendar stays so flows still name it. */
export function clearCalendarUrl(id: string): void {
  write(stored().map((item) => (item.id === id ? { ...item, urlEncrypted: '' } : item)));
  clearSecretFailures('calendar', id);
}

/** The settings warning's "remove": a subscription loses its address, an account its password. */
export function clearBrokenCalendarSecret(id: string): void {
  if (isDavAccountId(id)) clearDavPassword(id);
  else clearCalendarUrl(id);
}

/** Factory reset only: the file sits beside config.json, so resetting config alone leaves it. */
export function clearAllCalendars(): void {
  for (const item of stored()) clearSecretFailures('calendar', item.id);
  write([]);
  clearAllDavAccounts();
}

/** Decrypts every secret at startup purely to file failures, before a morning flow needs one. */
export function probeCalendars(): void {
  for (const item of stored()) decryptUrl(item);
  probeDavAccounts();
}

export function reEncryptCalendars(): void {
  write(stored().map((item) => {
    const plaintext = decryptToken(item.urlEncrypted, `calendar.url (${item.id})`);
    return plaintext ? { ...item, urlEncrypted: encryptToken(plaintext) } : item;
  }));
  reEncryptDavAccounts();
}

