/**
 * Opens a mailbox's IMAP and SMTP connections with the right sign-in: its password, or an access
 * token from its Microsoft refresh token. The connector, the email step and the card all come
 * through here, so none of them branches on how a mailbox signs in.
 */
import type { Transporter } from 'nodemailer';
import type { ImapFlow } from 'imapflow';
import { clearStoredSecret, config, saveConfig } from '../config';
import { MICROSOFT_MAIL_CLIENT_ID } from '../../shared/microsoftMail';
import type { MailAccount } from './mailAccount';
import { openImapClient } from './mailClient';
import { createSmtpTransport } from './mailCompose';
import { createMicrosoftTokenSource, type FetchLike } from './microsoftAuth';

export const microsoftTokens = createMicrosoftTokenSource({
  clientId: () => MICROSOFT_MAIL_CLIENT_ID,
  fetch: ((url, init) => fetch(url, init)) as FetchLike,
  now: () => Date.now(),
  saveRefreshToken: (id, previous, refreshToken) => {
    if (!stillHolds(id, previous)) return;
    saveConfig({ mailAccounts: config.mailAccounts.map((account) => (account.id === id ? { ...account, password: refreshToken } : account)) });
  },
  // A blank password would keep the stored one; clearing removes the dead token itself.
  forgetRefreshToken: (id, previous) => {
    if (stillHolds(id, previous)) clearStoredSecret('smtp', id, 'password');
  },
});

/** The mailbox is still the Microsoft sign-in a renewal started from. */
function stillHolds(id: string, refreshToken: string): boolean {
  const account = config.mailAccounts.find((entry) => entry.id === id);
  return account?.auth === 'microsoft' && account.password === refreshToken;
}

/** The XOAUTH2 token for a Microsoft mailbox; undefined for a password one. */
export async function mailAccessToken(account: MailAccount): Promise<string | undefined> {
  return account.auth === 'microsoft' ? microsoftTokens.accessToken(account) : undefined;
}

export async function openMailImap(account: MailAccount & { imap: { host: string; port: number } }): Promise<ImapFlow> {
  return openImapClient(account, await mailAccessToken(account));
}

export async function openMailSmtp(account: MailAccount): Promise<Transporter> {
  return createSmtpTransport(account.smtp, await mailAccessToken(account));
}
