import { DavError, createDavClient, homeMoved } from './caldav/davClient';
import type { DavClient, DiscoveredAccount, DiscoveredCalendar } from './caldav/davClient';
import type { StoredDavAccount } from './calendarFile';
import {
  davCredentials, findDavAccount, findDavAccountBySignIn, listDavAccounts, putDavAccount, sameDavSignIn, setDavCalendars,
} from './calDavStore';
import { calDavServerForMailbox, findCalDavProvider, normalizeCalDavServer } from '../../shared/calDav';
import type { CalDavAccountInput, CalDavRefreshResult, CalDavSaveError, CalDavSaveResult } from '../../shared/calDav';

/**
 * Adding, changing and refreshing a CalDAV account. Saving always discovers first: an account is
 * stored only once its server signed it in and named at least one calendar that holds events.
 */

export interface LinkedMailbox {
  address: string;
  password: string;
  imapHost: string;
  /** A mailbox that signs in with Microsoft has a token, not a password a calendar server takes. */
  auth: string;
}

export interface CalDavAccountDeps {
  client: (signIn: { username: string; password: string }) => DavClient;
  mailbox: (mailAccountId: string) => LinkedMailbox | null;
  log: (line: string) => void;
}

/** A refresh signs in with what is stored (its own password or its mailbox's): no mailbox lookup. */
export type CalDavRefreshDeps = Pick<CalDavAccountDeps, 'client' | 'log'>;

export function defaultClient(signIn: { username: string; password: string }): DavClient {
  return createDavClient(signIn);
}

function saveErrorOf(err: unknown): CalDavSaveError {
  if (!(err instanceof DavError)) return 'other';
  switch (err.kind) {
    case 'auth': case 'forbidden': return 'auth';
    case 'unreachable': return 'unreachable';
    case 'tls': return 'tls';
    case 'insecure': return 'insecure';
    case 'notCalDav': case 'notFound': return 'notCalDav';
    default: return 'other';
  }
}

interface SignIn {
  provider: CalDavAccountInput['provider'];
  server: string;
  username: string;
  password: string;
  /** Undefined = keep the stored password (only the same user on the same server). */
  newPassword: string | undefined;
  mailAccountId?: string;
}

function resolveSignIn(input: CalDavAccountInput, deps: CalDavAccountDeps): SignIn | CalDavSaveError {
  const existing = input.id ? findDavAccount(input.id) : undefined;
  if (input.id && !existing) return 'missing';
  if (input.mailAccountId) {
    const mailbox = deps.mailbox(input.mailAccountId);
    const server = mailbox && mailbox.auth !== 'microsoft' ? calDavServerForMailbox(mailbox.address, mailbox.imapHost) : null;
    if (!mailbox || !server || !mailbox.password) return 'mailbox';
    return { ...server, username: mailbox.address, password: mailbox.password, newPassword: undefined, mailAccountId: input.mailAccountId };
  }
  const provider = findCalDavProvider(input.provider);
  const server = normalizeCalDavServer(provider.server || String(input.server ?? ''));
  if (server === 'insecure') return 'insecure';
  if (!server) return 'server';
  const username = String(input.username ?? '').trim();
  if (!username) return 'username';
  const typed = String(input.password ?? '').trim();
  if (typed) return { provider: provider.id, server, username, password: typed, newPassword: typed };
  // A blank field keeps the stored password only for the same user on the same server: a password
  // must never be sent to a server it was not typed for.
  if (!existing || existing.mailAccountId || !sameDavSignIn(existing, { server, username })) return 'password';
  const stored = davCredentials(existing.id);
  if (!stored) return 'password';
  return { provider: provider.id, server, username, password: stored.password, newPassword: undefined };
}

function toStored(calendars: DiscoveredCalendar[]): { url: string; name: string; writable: boolean; color: string }[] {
  return calendars.map(({ url, name, writable, color }) => ({ url, name, writable, color }));
}

export async function saveCalDavAccount(input: CalDavAccountInput, deps: CalDavAccountDeps): Promise<CalDavSaveResult> {
  const signIn = resolveSignIn(input, deps);
  if (typeof signIn === 'string') return { ok: false, error: signIn };
  if (findDavAccountBySignIn(signIn.server, signIn.username, input.id ?? '')) return { ok: false, error: 'duplicate' };
  let found: DiscoveredAccount;
  try {
    found = await deps.client(signIn).discover(signIn.server);
  } catch (err) {
    deps.log(`📅 CalDAV sign-in failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, error: saveErrorOf(err) };
  }
  const { calendars } = found;
  if (calendars.length === 0) return { ok: false, error: 'noCalendars' };
  const id = await putDavAccount({
    ...(input.id ? { id: input.id } : {}),
    provider: signIn.provider,
    server: signIn.server,
    home: found.home,
    username: signIn.username,
    ...(signIn.mailAccountId ? { mailAccountId: signIn.mailAccountId } : signIn.newPassword !== undefined ? { password: signIn.newPassword } : {}),
    calendars: toStored(calendars),
  });
  deps.log(`📅 CalDAV account ${input.id ? 'updated' : 'added'}: ${calendars.length} calendar(s)`);
  return { ok: true, id, accounts: listDavAccounts() };
}

/**
 * The account's calendars as the server lists them now: one PROPFIND on the home discovery found
 * before; the whole discovery again only when there is no home yet, or it no longer answers as
 * one (RFC 6764 §6). A refused password or a dead network is reported, not rediscovered.
 */
async function readCalendarList(client: DavClient, account: StoredDavAccount, deps: CalDavRefreshDeps): Promise<DiscoveredAccount> {
  if (account.home) {
    try {
      const calendars = await client.listCalendars(account.home);
      if (calendars.length > 0) return { home: account.home, calendars };
      deps.log('📅 CalDAV home lists no calendar now; discovering again');
    } catch (err) {
      if (!homeMoved(err)) throw err;
      deps.log(`📅 CalDAV home stopped answering (${err instanceof Error ? err.message : String(err)}); discovering again`);
    }
  }
  return client.discover(account.server);
}

/** Reads the account's calendar list again (a calendar made on the phone shows up here). */
export async function refreshCalDavAccount(id: string, deps: CalDavRefreshDeps): Promise<CalDavRefreshResult> {
  const account = findDavAccount(id);
  if (!account) return { ok: false, error: 'missing', accounts: listDavAccounts() };
  const signIn = davCredentials(id);
  if (!signIn) return { ok: false, error: account.mailAccountId ? 'mailbox' : 'password', accounts: listDavAccounts() };
  try {
    const { home, calendars } = await readCalendarList(deps.client(signIn), account, deps);
    if (calendars.length > 0) setDavCalendars(id, toStored(calendars), home);
    return calendars.length > 0
      ? { ok: true, accounts: listDavAccounts() }
      : { ok: false, error: 'noCalendars', accounts: listDavAccounts() };
  } catch (err) {
    deps.log(`📅 CalDAV refresh failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, error: saveErrorOf(err), accounts: listDavAccounts() };
  }
}

/** A client signed in as the account; throws when the account can no longer sign in. */
export function davClientFor(accountId: string, client: CalDavAccountDeps['client'] = defaultClient): DavClient {
  const signIn = davCredentials(accountId);
  if (!signIn) throw new DavError('auth', 0, 'The calendar account has no usable password; enter it again in Settings');
  return client(signIn);
}
