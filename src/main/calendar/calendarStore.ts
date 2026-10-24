import { randomUUID } from 'node:crypto';
import type Store from 'electron-store';
import { openStoreWithRecovery } from '../configStore';
import { getConfigDir } from '../configPaths';
import { decryptToken, decryptTokenChecked, encryptToken } from '../configEncryption';
import { clearSecretFailures, recordSecretFailure } from '../secretHealth';
import { CALENDAR_NAME_MAX, calendarNameKey, normalizeCalendarUrl } from '../../shared/calendars';
import type { CalendarSaveRequest, CalendarSaveResult, CalendarSummary } from '../../shared/calendars';

/**
 * Calendar subscriptions, in their own file next to config.json (like the data-source keys and
 * MCP tokens): the .ics address is encrypted with the OS key, the name and id are not. Flows
 * hold only the id or the name, so an exported or shared flow carries no address.
 */
interface StoredCalendar {
  id: string;
  name: string;
  urlEncrypted: string;
}

interface CalendarStoreShape {
  calendars: StoredCalendar[];
}

let store: Store<CalendarStoreShape> | null = null;

function getStore(): Store<CalendarStoreShape> {
  if (!store) {
    store = openStoreWithRecovery<CalendarStoreShape>('calendars', getConfigDir(), { calendars: [] });
  }
  return store;
}

function stored(): StoredCalendar[] {
  const list = getStore().store.calendars;
  if (!Array.isArray(list)) return [];
  return list.filter((entry): entry is StoredCalendar => Boolean(entry)
    && typeof entry.id === 'string' && typeof entry.name === 'string' && typeof entry.urlEncrypted === 'string');
}

function write(list: StoredCalendar[]): void {
  getStore().set('calendars', list);
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
  return { id: entry.id, name: entry.name, host: hostOf(url), unreadable: failed || !url };
}

export function listCalendars(): CalendarSummary[] {
  return stored().map(summaryOf);
}

/** How many calendars are subscribed, without opening their addresses. */
export function calendarCount(): number {
  return stored().length;
}

export interface ResolvedCalendar {
  id: string;
  name: string;
  url: string;
  unreadable: boolean;
}

export type CalendarLookup =
  | { kind: 'found'; calendar: ResolvedCalendar }
  | { kind: 'none' }
  | { kind: 'pick' }
  | { kind: 'unknown' };

/**
 * What a step's `calendar` field points at: an id (what the editor stores), else a name as the
 * person or the AI wrote it. Blank picks the only calendar there is; with several it asks.
 */
export function findCalendar(ref: string): CalendarLookup {
  const list = stored();
  if (list.length === 0) return { kind: 'none' };
  const wanted = ref.trim();
  let entry: StoredCalendar | undefined;
  if (!wanted) {
    if (list.length > 1) return { kind: 'pick' };
    entry = list[0];
  } else {
    entry = list.find((item) => item.id === wanted)
      ?? list.find((item) => calendarNameKey(item.name) === calendarNameKey(wanted));
  }
  if (!entry) return { kind: 'unknown' };
  const { url, failed } = decryptUrl(entry);
  return { kind: 'found', calendar: { id: entry.id, name: entry.name, url, unreadable: failed || !url } };
}

/** The decrypted address of one stored calendar ('' when unknown or unreadable). */
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

/** Factory reset only: the file sits beside config.json, so resetting config alone leaves it. */
export function clearAllCalendars(): void {
  for (const item of stored()) clearSecretFailures('calendar', item.id);
  write([]);
}

/** Decrypts every address at startup purely to file failures, before a morning flow needs one. */
export function probeCalendars(): void {
  for (const item of stored()) decryptUrl(item);
}

export function reEncryptCalendars(): void {
  write(stored().map((item) => {
    const plaintext = decryptToken(item.urlEncrypted, `calendar.url (${item.id})`);
    return plaintext ? { ...item, urlEncrypted: encryptToken(plaintext) } : item;
  }));
}
