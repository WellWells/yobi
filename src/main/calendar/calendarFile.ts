import type Store from 'electron-store';
import { openStoreWithRecovery } from '../configStore';
import { getConfigDir } from '../configPaths';
import type { CalDavProviderId } from '../../shared/calDav';

/**
 * `calendars.json`, next to config.json: .ics subscriptions and CalDAV accounts. Every secret in it
 * (an .ics address, an account password) is encrypted with the OS key; names, ids and the CalDAV
 * collection addresses (useless without the password) are not. Not in backups: the ciphertext only
 * opens on this computer.
 */
export interface StoredCalendar {
  id: string;
  name: string;
  urlEncrypted: string;
}

export interface StoredDavCalendar {
  id: string;
  name: string;
  /** The collection's absolute address, as discovery found it (iCloud's sits on another host). */
  url: string;
  writable: boolean;
  color: string;
}

/** Where discovery led: refreshing the list asks `homeUrl` directly, and discovers again only when it fails. */
export interface StoredDavHome {
  rootUrl: string;
  principalUrl: string;
  homeUrl: string;
}

export interface StoredDavAccount {
  id: string;
  provider: CalDavProviderId;
  /** Where discovery starts; the calendars carry their own addresses. */
  server: string;
  /** Absent on accounts saved before it was kept: the next refresh discovers and stores it. */
  home?: StoredDavHome;
  username: string;
  /** '' for an account that signs in as one of the user's mailboxes (`mailAccountId`). */
  passwordEncrypted: string;
  /**
   * Signs in with that mailbox's address and app password (iCloud, Yahoo and Fastmail take the
   * same one for mail and CalDAV): one secret, so a new mail password reaches the calendar too.
   */
  mailAccountId?: string;
  calendars: StoredDavCalendar[];
}

export interface CalendarStoreShape {
  calendars: StoredCalendar[];
  caldavAccounts?: StoredDavAccount[];
}

let store: Store<CalendarStoreShape> | null = null;

export function calendarFile(): Store<CalendarStoreShape> {
  if (!store) {
    store = openStoreWithRecovery<CalendarStoreShape>('calendars', getConfigDir(), { calendars: [] });
  }
  return store;
}
