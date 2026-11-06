/**
 * CalDAV accounts: a calendar server signed in to with a user name and an app password, whose
 * calendars Yobi reads and (where the account may) writes. Google takes OAuth only on CalDAV and
 * Outlook has none, so neither is offered here.
 */

export type CalDavProviderId = 'icloud' | 'fastmail' | 'nextcloud' | 'yahoo' | 'custom';

export interface CalDavProvider {
  id: CalDavProviderId;
  /** The address discovery starts from; '' = the user types their own server. */
  server: string;
  /** Where the user makes an app password: the page itself where known, else the service's help. */
  helpUrl?: string;
}

export const CALDAV_PROVIDERS: readonly CalDavProvider[] = [
  // The Apple ID email as the user name; only an app-specific password signs in.
  { id: 'icloud', server: 'https://caldav.icloud.com/', helpUrl: 'https://support.apple.com/102654' },
  { id: 'fastmail', server: 'https://caldav.fastmail.com/', helpUrl: 'https://www.fastmail.help/hc/en-us/articles/1500000278342' },
  // Every Nextcloud is someone's own server: https://<host>/remote.php/dav.
  { id: 'nextcloud', server: '' },
  { id: 'yahoo', server: 'https://caldav.calendar.yahoo.com/', helpUrl: 'https://help.yahoo.com/kb/SLN15241.html' },
  { id: 'custom', server: '' },
];

export function findCalDavProvider(id: string): CalDavProvider {
  return CALDAV_PROVIDERS.find((provider) => provider.id === id) ?? CALDAV_PROVIDERS[CALDAV_PROVIDERS.length - 1];
}

/** What Settings sees of one account: never the password, and the server only as its host. */
export interface CalDavAccountSummary {
  id: string;
  provider: CalDavProviderId;
  username: string;
  /** The address discovery started from; not a secret (it reads nothing without the password). */
  server: string;
  host: string;
  /** The stored password can no longer be decrypted (or the linked mailbox is gone); it has to be entered again. */
  unreadable: boolean;
  /** Signs in as this mailbox (its address); '' when the account has its own password. */
  mailbox: string;
  /** The mailbox account it signs in as; '' when it has its own password. */
  mailAccountId: string;
  calendars: CalDavCalendarSummary[];
}

export interface CalDavCalendarSummary {
  id: string;
  name: string;
  writable: boolean;
  /** "#RRGGBB" when the server has one. */
  color: string;
}

export interface CalDavAccountInput {
  /** Absent for a new account. */
  id?: string;
  provider: CalDavProviderId;
  /** The server address; a provider with its own address ignores what is typed. */
  server: string;
  username: string;
  /** Blank when editing keeps the stored password (same server and user name only). */
  password: string;
  /** Sign in as this mailbox instead: server, user name and password all come from it. */
  mailAccountId?: string;
}

/**
 * Why saving failed, as the card shows it: `auth` wrong user name or password, `unreachable` no
 * answer, `tls` the certificate, `notCalDav` the address answers but is no calendar server,
 * `noCalendars` signed in but no calendar holds events, `insecure` an http:// address (only this
 * computer may go without TLS), `server`/`username`/`password` a field is missing, `duplicate`
 * the same user on the same server is already there, `missing` the account is gone, `mailbox` the
 * mailbox to sign in as is gone or reaches no CalDAV server, `other`.
 */
export type CalDavSaveError =
  | 'auth' | 'unreachable' | 'tls' | 'notCalDav' | 'noCalendars' | 'insecure'
  | 'server' | 'username' | 'password' | 'duplicate' | 'missing' | 'mailbox' | 'other';

export type CalDavSaveResult =
  | { ok: true; id: string; accounts: CalDavAccountSummary[] }
  | { ok: false; error: CalDavSaveError };

export type CalDavRefreshResult =
  | { ok: true; accounts: CalDavAccountSummary[] }
  | { ok: false; error: CalDavSaveError; accounts: CalDavAccountSummary[] };

/** A mailbox whose app password also signs in to its provider's CalDAV server. */
export interface MailCalendarServer {
  provider: CalDavProviderId;
  server: string;
}

/**
 * The CalDAV server a mailbox's own sign-in reaches: iCloud, Yahoo and Fastmail take the same app
 * password for both. Gmail's CalDAV takes OAuth only and Outlook has none, so they get null.
 */
export function calDavServerForMailbox(address: string, imapHost: string): MailCalendarServer | null {
  const domain = address.slice(address.lastIndexOf('@') + 1).trim().toLowerCase();
  const host = imapHost.trim().toLowerCase();
  const server = (id: CalDavProviderId): MailCalendarServer => ({ provider: id, server: findCalDavProvider(id).server });
  if (['icloud.com', 'me.com', 'mac.com'].includes(domain) || host === 'imap.mail.me.com') return server('icloud');
  if (/^(yahoo\.com(\.tw)?|ymail\.com|rocketmail\.com)$/.test(domain) || host === 'imap.mail.yahoo.com') return server('yahoo');
  if (/^fastmail\.(com|fm)$/.test(domain) || host === 'imap.fastmail.com') return server('fastmail');
  return null;
}

/** Hosts a calendar server may answer on without TLS: this computer only. */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

/**
 * The server address a person typed, made into a URL discovery can start from: a bare host gets
 * https://, a path keeps its trailing slash. '' = not a usable address; 'insecure' = http:// to
 * anything but this computer (the password would cross the network in the clear).
 */
export function normalizeCalDavServer(raw: string): string | 'insecure' {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) return 'insecure';
  if (url.username || url.password) return '';
  url.hash = '';
  url.search = '';
  if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`;
  return url.toString();
}

/** A mailbox Settings offers to sign in as: its own sign-in also reaches this provider's calendars. */
export interface CalDavLinkableMailbox {
  id: string;
  address: string;
  provider: CalDavProviderId;
}

export interface CalDavSnapshot {
  accounts: CalDavAccountSummary[];
  mailboxes: CalDavLinkableMailbox[];
}
