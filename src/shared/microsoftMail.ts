/**
 * Signing in to Outlook.com / Hotmail / Microsoft 365 mail with a Microsoft account (OAuth 2.0 with
 * PKCE, Yobi as a public client). Microsoft stopped taking passwords: an Outlook.com app password
 * was refused with `535 5.7.3 Authentication unsuccessful` (2026-10-23).
 *
 * One token serves both servers: its scopes are IMAP and SMTP on `outlook.office.com`, signed in
 * with XOAUTH2 — the way Thunderbird reaches the same mailboxes.
 */

/**
 * Yobi's app registration in Microsoft Entra ("Accounts in any organizational directory and
 * personal Microsoft accounts", platform "Mobile and desktop applications", redirect URI
 * `MICROSOFT_REDIRECT_URI`, public client flows allowed, no client secret). A public client's id is
 * not a secret: it ships in every copy of the app. Blank = not registered: the card then says so
 * instead of offering a sign-in that cannot work.
 */
export const MICROSOFT_MAIL_CLIENT_ID = '2c32a320-d83d-4cd5-87fb-f7c809eaeb3a';

/** Registered as is; the loopback port is left out because Microsoft ignores it for localhost. */
export const MICROSOFT_REDIRECT_URI = 'http://localhost/callback';

export const MICROSOFT_AUTHORIZE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
export const MICROSOFT_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

/** IMAP and SMTP on one resource, a refresh token, and the address the user picked (id token). */
export const MICROSOFT_MAIL_SCOPES = [
  'https://outlook.office.com/IMAP.AccessAsUser.All',
  'https://outlook.office.com/SMTP.Send',
  'offline_access',
  'openid',
  'email',
  'profile',
] as const;

/** The tenant every personal Microsoft account (Outlook.com, Hotmail, Live) signs in under. */
export const MICROSOFT_CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

export const MICROSOFT_IMAP = { host: 'outlook.office365.com', port: 993 } as const;
/** Outlook.com and Microsoft 365 publish different SMTP hosts for OAuth sign-in. */
export const MICROSOFT_SMTP_PERSONAL = { host: 'smtp-mail.outlook.com', port: 587 } as const;
export const MICROSOFT_SMTP_WORK = { host: 'smtp.office365.com', port: 587 } as const;

/** How a mailbox signs in: an (app) password, or a Microsoft account. */
export type MailAuthKind = 'password' | 'microsoft';

export function microsoftSignInAvailable(): boolean {
  return MICROSOFT_MAIL_CLIENT_ID.trim() !== '';
}
