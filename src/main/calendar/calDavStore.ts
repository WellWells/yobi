import { createHash, randomUUID } from 'node:crypto';
import { decryptToken, decryptTokenChecked, encryptSecret } from '../configEncryption';
import { clearSecretFailures, recordSecretFailure } from '../secretHealth';
import { calendarFile } from './calendarFile';
import type { StoredDavAccount, StoredDavCalendar, StoredDavHome } from './calendarFile';
import type { CalDavAccountSummary, CalDavProviderId } from '../../shared/calDav';

/**
 * CalDAV accounts in `calendars.json`. The password is encrypted with the OS key and only ever
 * decrypted here, for a request; Settings sees the user name, the server's host and the calendars.
 */

const ACCOUNT_PREFIX = 'dava_';
const CALENDAR_PREFIX = 'davc_';

export function isDavAccountId(id: string): boolean {
  return id.startsWith(ACCOUNT_PREFIX);
}

/** Stable across refreshes: the same collection of the same account keeps the id a flow stored. */
export function davCalendarId(accountId: string, url: string): string {
  return `${CALENDAR_PREFIX}${createHash('sha256').update(`${accountId}\n${url}`).digest('hex').slice(0, 10)}`;
}

function isCalendar(entry: unknown): entry is StoredDavCalendar {
  const item = entry as StoredDavCalendar | null;
  return item !== null && typeof item === 'object' && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.url === 'string';
}

/** A mailbox's sign-in as config holds it (password already decrypted), or null when it is gone. */
export interface MailboxSignIn {
  address: string;
  password: string;
}

/** Set once at startup (`ipc/calendars.ts`): config is not this module's to import. */
let mailboxSignIn: (mailAccountId: string) => MailboxSignIn | null = () => null;

export function setMailboxSignInSource(read: (mailAccountId: string) => MailboxSignIn | null): void {
  mailboxSignIn = read;
}

function homeOf(value: unknown): StoredDavHome | undefined {
  const home = value as Partial<StoredDavHome> | null;
  if (!home || typeof home !== 'object') return undefined;
  const { rootUrl, principalUrl, homeUrl } = home;
  return typeof rootUrl === 'string' && typeof principalUrl === 'string' && typeof homeUrl === 'string' && homeUrl
    ? { rootUrl, principalUrl, homeUrl }
    : undefined;
}

function stored(): StoredDavAccount[] {
  const list = calendarFile().store.caldavAccounts;
  if (!Array.isArray(list)) return [];
  return list
    .filter((entry): entry is StoredDavAccount => Boolean(entry) && typeof entry.id === 'string'
      && typeof entry.server === 'string' && typeof entry.username === 'string' && typeof entry.passwordEncrypted === 'string')
    .map((entry) => ({
      ...entry,
      home: homeOf(entry.home),
      ...(typeof entry.mailAccountId === 'string' && entry.mailAccountId ? { mailAccountId: entry.mailAccountId } : { mailAccountId: undefined }),
      provider: (typeof entry.provider === 'string' ? entry.provider : 'custom') as CalDavProviderId,
      calendars: Array.isArray(entry.calendars)
        ? entry.calendars.filter(isCalendar).map((item) => ({ ...item, writable: item.writable === true, color: typeof item.color === 'string' ? item.color : '' }))
        : [],
    }));
}

function write(list: StoredDavAccount[]): void {
  calendarFile().set('caldavAccounts', list);
}

function decryptPassword(entry: StoredDavAccount): { password: string; failed: boolean } {
  const result = decryptTokenChecked(entry.passwordEncrypted, `calendar.password (${entry.id})`);
  if (result.failed) recordSecretFailure({ scope: 'calendar', id: entry.id, field: 'password', label: entry.username });
  else clearSecretFailures('calendar', entry.id);
  return { password: result.value, failed: result.failed };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** The user name and password a request signs in with, from the account itself or its mailbox. */
function signInOf(entry: StoredDavAccount): { username: string; password: string } | null {
  if (entry.mailAccountId) {
    const mailbox = mailboxSignIn(entry.mailAccountId);
    return mailbox?.password ? { username: mailbox.address, password: mailbox.password } : null;
  }
  const { password, failed } = decryptPassword(entry);
  return failed || !password ? null : { username: entry.username, password };
}

/** Whether the account can sign in at all, without decrypting anything (lists and step pickers). */
export function davAccountUsable(entry: StoredDavAccount): boolean {
  return entry.mailAccountId ? Boolean(mailboxSignIn(entry.mailAccountId)?.password) : Boolean(entry.passwordEncrypted);
}

function summaryOf(entry: StoredDavAccount): CalDavAccountSummary {
  const mailbox = entry.mailAccountId ? mailboxSignIn(entry.mailAccountId) : null;
  return {
    id: entry.id,
    provider: entry.provider,
    username: mailbox?.address ?? entry.username,
    server: entry.server,
    host: hostOf(entry.server),
    unreadable: !signInOf(entry),
    mailbox: entry.mailAccountId ? mailbox?.address ?? entry.username : '',
    mailAccountId: entry.mailAccountId ?? '',
    calendars: entry.calendars.map(({ id, name, writable, color }) => ({ id, name, writable, color })),
  };
}

export function listDavAccounts(): CalDavAccountSummary[] {
  return stored().map(summaryOf);
}

/** The account and calendar behind each CalDAV calendar, in Settings order (no secret decrypted). */
export function davCalendarEntries(): { account: StoredDavAccount; calendar: StoredDavCalendar }[] {
  return stored().flatMap((account) => account.calendars.map((calendar) => ({ account, calendar })));
}

export function findDavAccount(id: string): StoredDavAccount | undefined {
  return stored().find((entry) => entry.id === id);
}

export interface DavCredentials {
  accountId: string;
  server: string;
  username: string;
  password: string;
}

/** What a request signs in with; null when the account is gone or cannot sign in any more. */
export function davCredentials(accountId: string): DavCredentials | null {
  const entry = findDavAccount(accountId);
  const signIn = entry ? signInOf(entry) : null;
  if (!entry || !signIn) return null;
  return { accountId: entry.id, server: entry.server, ...signIn };
}

/** Same user on the same server: the only case a blank password field keeps the stored one. */
export function sameDavSignIn(a: { server: string; username: string }, b: { server: string; username: string }): boolean {
  return a.server === b.server && a.username.trim().toLowerCase() === b.username.trim().toLowerCase();
}

export function findDavAccountBySignIn(server: string, username: string, exceptId = ''): StoredDavAccount | undefined {
  return stored().find((entry) => entry.id !== exceptId && sameDavSignIn(entry, { server, username }));
}

export interface DavAccountWrite {
  id?: string;
  provider: CalDavProviderId;
  server: string;
  username: string;
  /** Plaintext; undefined keeps the stored one (the caller checked `sameDavSignIn`). */
  password?: string;
  /** Signs in as this mailbox; the account then stores no password of its own. */
  mailAccountId?: string;
  /** Where this sign-in's discovery led; always from the discovery that just signed it in. */
  home: StoredDavHome;
  /** Discovered collections (no ids yet); the store gives each its stable id. */
  calendars: Omit<StoredDavCalendar, 'id'>[];
}

/** Writes an account after discovery succeeded; returns its id. */
export async function putDavAccount(input: DavAccountWrite): Promise<string> {
  const newPassword = !input.mailAccountId && input.password !== undefined ? await encryptSecret(input.password) : undefined;
  // Read after the await: an account written meanwhile stays.
  const list = stored();
  const existing = input.id ? list.find((entry) => entry.id === input.id) : undefined;
  const id = existing?.id ?? `${ACCOUNT_PREFIX}${randomUUID().slice(0, 8)}`;
  const passwordEncrypted = input.mailAccountId
    ? ''
    : newPassword ?? existing?.passwordEncrypted ?? '';
  const next: StoredDavAccount = {
    id,
    provider: input.provider,
    server: input.server,
    home: input.home,
    username: input.username.trim(),
    passwordEncrypted,
    ...(input.mailAccountId ? { mailAccountId: input.mailAccountId } : {}),
    calendars: input.calendars.map((calendar) => ({ ...calendar, id: davCalendarId(id, calendar.url) })),
  };
  write(existing ? list.map((entry) => (entry.id === id ? next : entry)) : [...list, next]);
  if (input.password !== undefined) clearSecretFailures('calendar', id);
  return id;
}

/**
 * A refresh found these collections (and the home it listed them from); ids stay what they were for
 * the same addresses. Nothing is written when nothing changed: a refresh runs before most reads.
 */
export function setDavCalendars(accountId: string, calendars: Omit<StoredDavCalendar, 'id'>[], home: StoredDavHome): void {
  const list = stored();
  const entry = list.find((item) => item.id === accountId);
  if (!entry) return;
  const next: StoredDavAccount = { ...entry, home, calendars: calendars.map((calendar) => ({ ...calendar, id: davCalendarId(accountId, calendar.url) })) };
  if (JSON.stringify([entry.home, entry.calendars]) === JSON.stringify([next.home, next.calendars])) return;
  write(list.map((item) => (item.id === accountId ? next : item)));
}

export function removeDavAccount(id: string): void {
  clearSecretFailures('calendar', id);
  write(stored().filter((entry) => entry.id !== id));
}

/** Drops a password that can no longer be decrypted; the account and its calendars stay. */
export function clearDavPassword(id: string): void {
  write(stored().map((entry) => (entry.id === id ? { ...entry, passwordEncrypted: '' } : entry)));
  clearSecretFailures('calendar', id);
}

export function clearAllDavAccounts(): void {
  for (const entry of stored()) clearSecretFailures('calendar', entry.id);
  write([]);
}

/** A mailbox-linked account holds no secret of its own; the mail card reports its password. */
export function probeDavAccounts(): void {
  for (const entry of stored()) if (!entry.mailAccountId) decryptPassword(entry);
}

export async function reEncryptDavAccounts(): Promise<void> {
  const fresh = new Map<string, string>();
  for (const entry of stored()) {
    if (entry.mailAccountId) continue;
    const plaintext = decryptToken(entry.passwordEncrypted, `calendar.password (${entry.id})`);
    if (plaintext) fresh.set(entry.passwordEncrypted, await encryptSecret(plaintext, { fresh: true }));
  }
  write(stored().map((entry) => ({ ...entry, passwordEncrypted: fresh.get(entry.passwordEncrypted) ?? entry.passwordEncrypted })));
}
