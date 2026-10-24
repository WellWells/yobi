/**
 * Mail services the Mail card can fill in from the address alone. Each one signs in to IMAP and
 * SMTP with the same app password; the card links to the page that issues it.
 */

export interface MailServer {
  host: string;
  port: number;
}

export type MailProviderId = 'gmail' | 'yahoo' | 'icloud' | 'outlook';

export interface MailProvider {
  id: MailProviderId;
  domains: readonly string[];
  imap: MailServer;
  smtp: MailServer;
  /** Where the user makes an app password: the page itself where known, else the service's help. */
  helpUrl?: string;
  /** Takes no password at all: the card offers the service's own sign-in instead. */
  signIn?: 'microsoft';
}

export const MAIL_PROVIDERS: readonly MailProvider[] = [
  {
    id: 'gmail',
    domains: ['gmail.com', 'googlemail.com'],
    imap: { host: 'imap.gmail.com', port: 993 },
    smtp: { host: 'smtp.gmail.com', port: 465 },
    // The page that creates one (it asks the user to sign in and to have 2-Step Verification on).
    helpUrl: 'https://myaccount.google.com/apppasswords',
  },
  {
    id: 'yahoo',
    domains: ['yahoo.com', 'yahoo.com.tw', 'ymail.com', 'rocketmail.com'],
    imap: { host: 'imap.mail.yahoo.com', port: 993 },
    smtp: { host: 'smtp.mail.yahoo.com', port: 465 },
    helpUrl: 'https://help.yahoo.com/kb/SLN15241.html',
  },
  {
    id: 'icloud',
    domains: ['icloud.com', 'me.com', 'mac.com'],
    imap: { host: 'imap.mail.me.com', port: 993 },
    smtp: { host: 'smtp.mail.me.com', port: 587 },
    helpUrl: 'https://support.apple.com/102654',
  },
  {
    // Microsoft ended Basic Authentication for Outlook.com on 2024-09-16. Its account page still
    // issues app passwords, but a real one was refused with `535 5.7.3 Authentication unsuccessful`
    // (2026-10-23): these mailboxes sign in with a Microsoft account (`microsoftMail.ts`).
    id: 'outlook',
    domains: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'outlook.com.tw', 'hotmail.com.tw', 'live.com.tw'],
    imap: { host: 'outlook.office365.com', port: 993 },
    smtp: { host: 'smtp-mail.outlook.com', port: 587 },
    signIn: 'microsoft',
  },
];

export const IMAP_TLS_PORT = 993;

export type MailProviderMatch =
  | { kind: 'preset'; provider: MailProvider }
  | { kind: 'unknown' };

export function mailDomain(address: string): string {
  const at = address.lastIndexOf('@');
  return at < 0 ? '' : address.slice(at + 1).trim().toLowerCase();
}

export function detectMailProvider(address: string): MailProviderMatch {
  const domain = mailDomain(address);
  if (!domain) return { kind: 'unknown' };
  const provider = MAIL_PROVIDERS.find((entry) => entry.domains.includes(domain));
  return provider ? { kind: 'preset', provider } : { kind: 'unknown' };
}

/** The IMAP server for an account: the one the user typed, else the one its address implies. */
export function resolveImapServer(address: string, typed: { host: string; port: number }): MailServer | null {
  const host = typed.host.trim();
  if (host) return { host, port: typed.port > 0 ? typed.port : IMAP_TLS_PORT };
  const match = detectMailProvider(address);
  return match.kind === 'preset' ? { ...match.provider.imap } : null;
}
