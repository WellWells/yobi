import { randomBytes } from 'node:crypto';
import { ipcMain, shell } from 'electron';
import { IPC } from '../../shared/types';
import type { EmailSettingsSnapshot, MailAccountInput, MailAccountSaveResult } from '../../shared/types';
import { resolveImapServer } from '../../shared/mailProviders';
import { MICROSOFT_MAIL_CLIENT_ID, microsoftSignInAvailable } from '../../shared/microsoftMail';
import { config, saveConfig } from '../config';
import { getLangCache, t } from '../i18n';
import { normalizeImap, normalizeSmtp } from '../configNormalizers';
import type { MailAccountConfig } from '../configTypes';
import { sendLog } from '../helpers';
import { passwordMustBeRetyped, testMailAccount } from '../mail/mailAccountTest';

function snapshot(): EmailSettingsSnapshot {
  return {
    accounts: config.mailAccounts.map((account) => ({
      id: account.id,
      user: account.address,
      auth: account.auth,
      host: account.smtp.host,
      port: account.smtp.port,
      hasPassword: Boolean(account.password.trim()),
      imapHost: account.imap.host,
      imapPort: account.imap.port,
      readHost: resolveImapServer(account.address, account.imap)?.host ?? '',
    })),
    defaultId: config.mailAccounts.some((account) => account.id === config.mailDefaultId) ? config.mailDefaultId : (config.mailAccounts[0]?.id ?? ''),
  };
}

/** A short id that message ids start with; never reused while the account exists. */
function newAccountId(): string {
  const taken = new Set(config.mailAccounts.map((account) => account.id));
  for (;;) {
    const id = randomBytes(4).readUInt32BE(0).toString(36).slice(0, 6);
    if (id && !taken.has(id)) return id;
  }
}

function saveMail(mailAccounts: MailAccountConfig[], mailDefaultId: string): void {
  const defaultId = mailAccounts.some((account) => account.id === mailDefaultId) ? mailDefaultId : (mailAccounts[0]?.id ?? '');
  saveConfig({ mailAccounts, mailDefaultId: defaultId });
}

/** Stops the Microsoft sign-in waiting in the browser, if one is. */
let cancelMicrosoftSignIn: (() => void) | null = null;

async function closeConnection(accountId: string): Promise<void> {
  const { closeMailConnection } = await import('../mail/mailConnection');
  await closeMailConnection(accountId);
}

export function registerEmailHandlers(): void {
  ipcMain.handle(IPC.GET_EMAIL_SETTINGS, (): EmailSettingsSnapshot => snapshot());

  // Each account serves the email step and the Mail connector; saved only once both servers take it.
  ipcMain.handle(IPC.UPDATE_EMAIL_CREDENTIALS, async (_event, input: MailAccountInput): Promise<MailAccountSaveResult> => {
    const imap = normalizeImap({ host: input?.imapHost, port: input?.imapPort });
    const typed = normalizeSmtp({ host: input?.host, port: input?.port, user: input?.user, password: input?.password });
    const id = typeof input?.id === 'string' ? input.id : '';
    const saved = id ? config.mailAccounts.find((account) => account.id === id) : undefined;
    if (id && !saved) return { ok: false, stage: 'input', errorKey: 'settings.mail.error.accountGone', vars: {} };
    const address = typed.user.toLowerCase();
    if (config.mailAccounts.some((account) => account.id !== id && account.address.toLowerCase() === address)) {
      return { ok: false, stage: 'input', errorKey: 'settings.mail.error.duplicate', vars: { address: typed.user } };
    }
    // Only a password mailbox's own password is kept for a blank field: a Microsoft mailbox's secret
    // is a refresh token, which must never be sent to a server as a password.
    const reusable = saved?.auth === 'password' ? saved : undefined;
    if (reusable && !typed.password
      && passwordMustBeRetyped({ smtp: { ...reusable.smtp, user: reusable.address, password: reusable.password }, imap: reusable.imap }, { smtp: typed, imap })) {
      return { ok: false, stage: 'input', errorKey: 'settings.mail.error.passwordAgain', vars: {} };
    }
    const smtp = { ...typed, password: typed.password || (reusable?.password ?? '') };
    const { createSmtpTransport } = await import('../mail/mailCompose');
    const { openImapClient } = await import('../mail/mailClient');
    const result = await testMailAccount(smtp, imap, {
      verifySmtp: async (account) => {
        const transport = createSmtpTransport(account);
        try {
          await transport.verify();
        } finally {
          transport.close();
        }
      },
      loginImap: async (account) => {
        const client = await openImapClient(account);
        await client.logout().catch(() => client.close());
      },
    });
    if (!result.ok) {
      sendLog(`Mail account test failed (${result.stage}): ${result.vars.detail ?? result.errorKey}`);
      return result;
    }
    const entry: MailAccountConfig = {
      id: saved?.id ?? newAccountId(), address: smtp.user, auth: 'password', password: smtp.password,
      smtp: { host: smtp.host, port: smtp.port }, imap,
    };
    const accounts = saved
      ? config.mailAccounts.map((account) => (account.id === saved.id ? entry : account))
      : [...config.mailAccounts, entry];
    saveMail(accounts, config.mailDefaultId);
    sendLog(saved ? 'Mail account updated' : 'Mail account added');
    return { ok: true };
  });

  // Outlook.com / Hotmail / Microsoft 365: the browser sign-in instead of a password. `id` signs an
  // existing Microsoft mailbox in again (its sign-in expired or was revoked).
  ipcMain.handle(IPC.MAIL_MICROSOFT_SIGN_IN, async (_event, id: unknown): Promise<MailAccountSaveResult> => {
    if (!microsoftSignInAvailable()) return { ok: false, stage: 'input', errorKey: 'settings.mail.error.msUnavailable', vars: {} };
    const existing = typeof id === 'string' && id ? config.mailAccounts.find((account) => account.id === id) : undefined;
    if (typeof id === 'string' && id && !existing) return { ok: false, stage: 'input', errorKey: 'settings.mail.error.accountGone', vars: {} };
    const { startCallbackServer } = await import('../mcp/mcpCallbackServer');
    const { signInWithMicrosoft } = await import('../mail/microsoftAuth');
    const { connectMicrosoftMailbox } = await import('../mail/microsoftMailbox');
    const { createSmtpTransport } = await import('../mail/mailCompose');
    const { openImapClient } = await import('../mail/mailClient');
    // One sign-in at a time: a second click replaces a sign-in left open in the browser.
    cancelMicrosoftSignIn?.();
    let cancelThis: (() => void) | null = null;
    const result = await connectMicrosoftMailbox(existing, config.mailAccounts, {
      signIn: (loginHint) => signInWithMicrosoft({
        clientId: MICROSOFT_MAIL_CLIENT_ID,
        startServer: async () => {
          const server = await startCallbackServer((key, vars) => t(getLangCache(), key, vars));
          cancelThis = () => server.close();
          cancelMicrosoftSignIn = cancelThis;
          return server;
        },
        openBrowser: (url) => shell.openExternal(url),
        fetch: (url, init) => fetch(url, init),
      }, loginHint).finally(() => {
        if (cancelMicrosoftSignIn === cancelThis) cancelMicrosoftSignIn = null;
      }),
      verifySmtp: async (smtp, accessToken) => {
        const transport = createSmtpTransport(smtp, accessToken);
        try {
          await transport.verify();
        } finally {
          transport.close();
        }
      },
      loginImap: async (account, accessToken) => {
        const client = await openImapClient(account, accessToken);
        await client.logout().catch(() => client.close());
      },
      newAccountId,
    });
    if (!result.ok) {
      sendLog(`Microsoft mail sign-in failed (${result.stage}): ${result.vars.detail ?? result.errorKey}`);
      return result;
    }
    // The list may have changed while the browser was open: a mailbox signed in to again may be gone
    // (never bring it back), and the same address may have been added (take it over, never add twice).
    if (existing && !config.mailAccounts.some((account) => account.id === existing.id)) {
      return { ok: false, stage: 'input', errorKey: 'settings.mail.error.accountGone', vars: {} };
    }
    const address = result.entry.address.toLowerCase();
    const live = config.mailAccounts.find((account) => account.id === result.entry.id)
      ?? config.mailAccounts.find((account) => account.address.toLowerCase() === address);
    const entry = live ? { ...result.entry, id: live.id } : result.entry;
    const accounts = live
      ? config.mailAccounts.map((account) => (account.id === live.id ? entry : account))
      : [...config.mailAccounts, entry];
    saveMail(accounts, config.mailDefaultId);
    // A new sign-in replaces the old connection and the old cached token.
    await closeConnection(entry.id).catch(() => {});
    const replaced = Boolean(live);
    sendLog(replaced ? 'Mail account signed in again with Microsoft' : 'Mail account added with Microsoft');
    return { ok: true };
  });

  // The user closed the browser tab or changed their mind: stop waiting (the card shows "cancelled").
  ipcMain.handle(IPC.MAIL_MICROSOFT_CANCEL, () => {
    cancelMicrosoftSignIn?.();
  });

  ipcMain.handle(IPC.REMOVE_MAIL_ACCOUNT, async (_event, id: unknown): Promise<EmailSettingsSnapshot> => {
    if (typeof id !== 'string' || !config.mailAccounts.some((account) => account.id === id)) return snapshot();
    saveMail(config.mailAccounts.filter((account) => account.id !== id), config.mailDefaultId);
    await closeConnection(id).catch(() => {});
    sendLog('Mail account removed');
    return snapshot();
  });

  ipcMain.handle(IPC.SET_DEFAULT_MAIL_ACCOUNT, (_event, id: unknown): EmailSettingsSnapshot => {
    if (typeof id === 'string' && config.mailAccounts.some((account) => account.id === id)) saveMail(config.mailAccounts, id);
    return snapshot();
  });
}
