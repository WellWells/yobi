/**
 * Adding (or signing in again to) a mailbox through Microsoft: the browser sign-in, then both
 * servers tried with the new token, the same rule as a password mailbox — nothing is saved until
 * IMAP and SMTP both take it. Errors come back as translated keys for the card.
 */
import type { MailAccountSaveResult } from '../../shared/types';
import { MICROSOFT_IMAP, MICROSOFT_SMTP_PERSONAL, MICROSOFT_SMTP_WORK } from '../../shared/microsoftMail';
import type { MailAccountConfig, SmtpConfig } from '../configTypes';
import {
  MCP_AUTH_CANCELLED, MCP_AUTH_DENIED_PREFIX, MCP_AUTH_MISSING_CODE, MCP_AUTH_STATE_MISMATCH, MCP_AUTH_TIMED_OUT,
} from '../mcp/mcpErrors';
import type { MailAccount } from './mailAccount';
import { testMailAccount } from './mailAccountTest';
import { MicrosoftAuthError, type MicrosoftIdentity, type MicrosoftTokens } from './microsoftAuth';

type Failure = Extract<MailAccountSaveResult, { ok: false }>;

export interface MicrosoftMailboxDeps {
  signIn: (loginHint?: string) => Promise<{ tokens: MicrosoftTokens; identity: MicrosoftIdentity }>;
  verifySmtp: (smtp: SmtpConfig, accessToken: string) => Promise<void>;
  loginImap: (account: MailAccount & { imap: { host: string; port: number } }, accessToken: string) => Promise<void>;
  newAccountId: () => string;
}

/** The sign-in errors, as whole keys (the i18n check only sees keys written out in full). */
const SIGN_IN_ERROR_KEYS = {
  cancelled: 'settings.mail.error.msCancelled',
  incomplete: 'settings.mail.error.msIncomplete',
  timeout: 'settings.mail.error.msTimeout',
  noAddress: 'settings.mail.error.msNoAddress',
  failed: 'settings.mail.error.msFailed',
  wrongAccount: 'settings.mail.error.msWrongAccount',
  smtpRefused: 'settings.mail.error.msSmtpRefused',
  imapRefused: 'settings.mail.error.msImapRefused',
} as const;

/**
 * The card shows only the translated key; the raw text (Microsoft's AADSTS codes, the callback
 * server's English constants) rides along in `detail` for the log alone.
 */
function signInFailure(err: unknown): Failure {
  const message = err instanceof Error ? err.message : String(err);
  const fail = (errorKey: string): Failure => ({ ok: false, stage: 'input', errorKey, vars: { detail: message } });
  if (message === MCP_AUTH_TIMED_OUT) return fail(SIGN_IN_ERROR_KEYS.timeout);
  if (message === MCP_AUTH_CANCELLED || message === `${MCP_AUTH_DENIED_PREFIX}access_denied`) return fail(SIGN_IN_ERROR_KEYS.cancelled);
  if (message === MCP_AUTH_STATE_MISMATCH || message === MCP_AUTH_MISSING_CODE) return fail(SIGN_IN_ERROR_KEYS.incomplete);
  if (err instanceof MicrosoftAuthError && err.reason === 'noAddress') return fail(SIGN_IN_ERROR_KEYS.noAddress);
  return fail(SIGN_IN_ERROR_KEYS.failed);
}

/**
 * Signs in and tries both servers. `existing` is the mailbox being signed in to again; otherwise a
 * mailbox already listed under the picked address is taken over (it becomes a Microsoft one), so a
 * second copy of the same address never appears.
 */
export async function connectMicrosoftMailbox(
  existing: MailAccountConfig | undefined,
  accounts: readonly MailAccountConfig[],
  deps: MicrosoftMailboxDeps,
): Promise<{ ok: true; entry: MailAccountConfig; tokens: MicrosoftTokens } | Failure> {
  let signedIn: { tokens: MicrosoftTokens; identity: MicrosoftIdentity };
  try {
    signedIn = await deps.signIn(existing?.address);
  } catch (err) {
    return signInFailure(err);
  }
  const { tokens, identity } = signedIn;
  if (existing && existing.address.toLowerCase() !== identity.address.toLowerCase()) {
    return { ok: false, stage: 'input', errorKey: SIGN_IN_ERROR_KEYS.wrongAccount, vars: { expected: existing.address, address: identity.address } };
  }
  const target = existing ?? accounts.find((account) => account.address.toLowerCase() === identity.address.toLowerCase());
  const smtpServer = identity.personal ? MICROSOFT_SMTP_PERSONAL : MICROSOFT_SMTP_WORK;
  const entry: MailAccountConfig = {
    id: target?.id ?? deps.newAccountId(),
    address: identity.address,
    auth: 'microsoft',
    password: tokens.refreshToken,
    smtp: { ...smtpServer },
    imap: { ...MICROSOFT_IMAP },
  };
  const result = await testMailAccount(
    { host: entry.smtp.host, port: entry.smtp.port, user: entry.address, password: entry.password },
    entry.imap,
    {
      verifySmtp: (smtp) => deps.verifySmtp(smtp, tokens.accessToken),
      loginImap: (account) => deps.loginImap(account, tokens.accessToken),
    },
  );
  if (!result.ok) {
    // "Wrong password" makes no sense here: the token was refused, which on a work account usually
    // means the organisation switched that protocol off.
    if (result.errorKey === 'settings.mail.error.auth') {
      return { ...result, errorKey: result.stage === 'smtp' ? SIGN_IN_ERROR_KEYS.smtpRefused : SIGN_IN_ERROR_KEYS.imapRefused };
    }
    return result;
  }
  return { ok: true, entry, tokens };
}
