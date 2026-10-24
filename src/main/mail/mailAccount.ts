/**
 * The user's mailboxes: each one signs in to SMTP (and IMAP, when it has a server) with its address
 * and its own password. "Can send" and "can read" are decided here only, so the card, flow
 * readiness and the connector never disagree about which accounts are usable.
 */
import type { ImapConfig, MailAccountConfig, SmtpConfig } from '../configTypes';
import { resolveImapServer, type MailServer } from '../../shared/mailProviders';
import type { MailAuthKind } from '../../shared/microsoftMail';
import { isSmtpAccountComplete } from '../smtpAccount';

export interface MailAccount {
  id: string;
  address: string;
  /** For `microsoft`, `password` is the refresh token and the servers take an access token from it. */
  auth: MailAuthKind;
  password: string;
  smtp: SmtpConfig;
  /** Null for a send-only account (a relay such as SendGrid): no IMAP host typed or implied. */
  imap: MailServer | null;
}

export interface MailAccountsSource {
  mailAccounts: readonly MailAccountConfig[];
  mailDefaultId: string;
}

/** One stored account as the servers see it, or null while it lacks a server, address or password. */
export function mailAccountOf(entry: MailAccountConfig): MailAccount | null {
  const smtp: SmtpConfig = { host: entry.smtp.host, port: entry.smtp.port, user: entry.address, password: entry.password };
  // A Microsoft mailbox whose sign-in expired (no refresh token left) stays usable on purpose: every
  // use then fails with "sign in again". Dropping it would let "read all mailboxes" report no mail
  // for it, and a blank-account send move to another mailbox, without a word.
  const complete = entry.auth === 'microsoft'
    ? Boolean(entry.address.trim() && entry.smtp.host.trim())
    : isSmtpAccountComplete(smtp);
  if (!complete) return null;
  return {
    id: entry.id, address: entry.address, auth: entry.auth, password: entry.password, smtp,
    imap: resolveImapServer(entry.address, entry.imap),
  };
}

/** The same check for an account that is still being typed (the card's "test and save"). */
export function mailAccountFrom(smtp: SmtpConfig, imap: ImapConfig, id = '', auth: MailAuthKind = 'password'): MailAccount | null {
  return mailAccountOf({ id, address: smtp.user, auth, password: smtp.password, smtp: { host: smtp.host, port: smtp.port }, imap });
}

export function usableMailAccounts(source: MailAccountsSource): MailAccount[] {
  return source.mailAccounts.map(mailAccountOf).filter((account): account is MailAccount => account !== null);
}

/** Where new mail goes out from: the chosen default when it is usable, else the first usable account. */
export function defaultMailAccount(source: MailAccountsSource): MailAccount | null {
  const usable = usableMailAccounts(source);
  return usable.find((account) => account.id === source.mailDefaultId) ?? usable[0] ?? null;
}

/** An account named by its id or its address (any case); '' = the default. */
export function findMailAccount(source: MailAccountsSource, ref: string | undefined): MailAccount | null {
  const key = (ref ?? '').trim().toLowerCase();
  if (!key) return defaultMailAccount(source);
  return usableMailAccounts(source).find((account) => account.id === key || account.address.toLowerCase() === key) ?? null;
}

export function canReadMail(account: MailAccount | null): account is MailAccount & { imap: MailServer } {
  return account !== null && account.imap !== null;
}

export function readableMailAccounts(source: MailAccountsSource): (MailAccount & { imap: MailServer })[] {
  return usableMailAccounts(source).filter(canReadMail);
}

/**
 * Changes whenever reconnecting is needed: a different server, user or password. A Microsoft
 * refresh token rotates on every renewal without the sign-in changing, so it is left out.
 */
export function mailAccountKey(account: MailAccount & { imap: MailServer }): string {
  return JSON.stringify([account.imap.host, account.imap.port, account.address, account.auth === 'microsoft' ? 'microsoft' : account.password]);
}
