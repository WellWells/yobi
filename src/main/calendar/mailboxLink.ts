import { config } from '../config';
import { setMailboxSignInSource } from './calDavStore';
import { calDavServerForMailbox } from '../../shared/calDav';
import type { CalDavLinkableMailbox } from '../../shared/calDav';
import type { LinkedMailbox } from './calDavAccounts';

/**
 * The bridge from a CalDAV account to the mailbox it signs in as. config holds mailbox passwords
 * decrypted in memory; this is the only place the calendar side reads one.
 */
export function mailboxForCalendar(mailAccountId: string): LinkedMailbox | null {
  const account = config.mailAccounts.find((item) => item.id === mailAccountId);
  if (!account) return null;
  return { address: account.address, password: account.password, imapHost: account.imap.host, auth: account.auth };
}

/** Mailboxes whose own sign-in also reaches a CalDAV server (iCloud, Yahoo, Fastmail). */
export function linkableMailboxes(): CalDavLinkableMailbox[] {
  return config.mailAccounts.flatMap((account) => {
    const server = account.auth === 'microsoft' || !account.password ? null : calDavServerForMailbox(account.address, account.imap.host);
    return server ? [{ id: account.id, address: account.address, provider: server.provider }] : [];
  });
}

/** Called once when the calendar IPC registers, before any calendar is read. */
export function wireMailboxSignIn(): void {
  setMailboxSignInSource((id) => {
    const mailbox = mailboxForCalendar(id);
    return mailbox && mailbox.auth !== 'microsoft' ? { address: mailbox.address, password: mailbox.password } : null;
  });
}
