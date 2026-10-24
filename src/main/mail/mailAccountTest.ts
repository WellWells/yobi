/**
 * "Test and save" for the Mail card: the account is saved only after the SMTP server accepts the
 * sign-in and, when there is an IMAP server, IMAP does too. A failure is sorted into what the user
 * can fix — the password, the server name, a TLS problem — with the server's own words kept for
 * the rest.
 */
import type { ImapConfig, SmtpConfig } from '../configTypes';
import type { MailAccountSaveResult } from '../../shared/types';
import { canReadMail, mailAccountFrom, type MailAccount } from './mailAccount';

export type MailSignInFailure = 'auth' | 'unreachable' | 'tls' | 'other';

const UNREACHABLE_CODES = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH',
  'ECONNECTION', 'EDNS', 'ESOCKET', 'CONNECT_TIMEOUT', 'GREETING_TIMEOUT',
]);

export function classifyMailSignInError(err: unknown): MailSignInFailure {
  const e = (err && typeof err === 'object' ? err : {}) as Record<string, unknown>;
  const code = typeof e.code === 'string' ? e.code : '';
  const text = [e.message, e.responseText, e.response].filter((v) => typeof v === 'string').join(' ');
  if (e.authenticationFailed === true || code === 'EAUTH' || e.responseCode === 535 || e.responseCode === 534
    || /AUTHENTICATIONFAILED|invalid credentials|authentication failed|username and password not accepted/i.test(text)) {
    return 'auth';
  }
  if (code === 'ETLS' || /certificate|self[- ]signed|STARTTLS|\bTLS\b|\bSSL\b/i.test(text) || /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) {
    return 'tls';
  }
  if (UNREACHABLE_CODES.has(code) || /getaddrinfo|ECONNREFUSED|timed? ?out/i.test(text)) return 'unreachable';
  return 'other';
}

export interface MailAccountTestDeps {
  verifySmtp: (smtp: SmtpConfig) => Promise<void>;
  loginImap: (account: MailAccount & { imap: { host: string; port: number } }) => Promise<void>;
}

// Whole keys, not `settings.mail.error.${kind}`: i18n:check deletes a key it never sees written out
// (a template literal outside a `t(` call is invisible to it), and the renderer translates these.
const SIGN_IN_ERROR_KEYS: Readonly<Record<MailSignInFailure, string>> = {
  auth: 'settings.mail.error.auth',
  unreachable: 'settings.mail.error.unreachable',
  tls: 'settings.mail.error.tls',
  other: 'settings.mail.error.other',
};

function failure(stage: 'smtp' | 'imap', host: string, err: unknown): MailAccountSaveResult {
  const kind = classifyMailSignInError(err);
  const detail = err instanceof Error ? err.message : String(err);
  return { ok: false, stage, errorKey: SIGN_IN_ERROR_KEYS[kind], vars: { host, detail } };
}

/**
 * A blank password keeps the saved one — but only for the same account on the same servers.
 * Otherwise a new address would send the old account's password to another company's server.
 */
export function passwordMustBeRetyped(
  saved: { smtp: SmtpConfig; imap: ImapConfig },
  next: { smtp: Pick<SmtpConfig, 'host' | 'user'>; imap: ImapConfig },
): boolean {
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  return !same(saved.smtp.user, next.smtp.user) || !same(saved.smtp.host, next.smtp.host) || !same(saved.imap.host, next.imap.host);
}

export async function testMailAccount(smtp: SmtpConfig, imap: ImapConfig, deps: MailAccountTestDeps): Promise<MailAccountSaveResult> {
  const account = mailAccountFrom(smtp, imap);
  if (!account) return { ok: false, stage: 'input', errorKey: 'settings.mail.error.incomplete', vars: {} };
  try {
    await deps.verifySmtp(smtp);
  } catch (err) {
    return failure('smtp', smtp.host, err);
  }
  if (canReadMail(account)) {
    try {
      await deps.loginImap(account);
    } catch (err) {
      return failure('imap', account.imap.host, err);
    }
  }
  return { ok: true };
}
