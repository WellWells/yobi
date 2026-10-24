/**
 * Electron wiring for the Mail connector: the account from config, the shared IMAP connection, the
 * MIME parser, SMTP through the email step's composer, and attachments saved into Downloads/Yobi.
 * Loaded lazily by the registry, so imapflow and mailparser never load at startup.
 */
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressObject } from 'mailparser';
import { config } from '../config';
import { yobiDownloadsDir } from '../downloadsCache';
import { declaredExtension, isRunnableName, looksLikeProgram, PROGRAM_SNIFF_BYTES } from '../executableFiles';
import { sanitizeDownloadName } from '../flow/skills/fileOps';
import { saveIntoFolder } from '../flow/skills/savedDownloads';
import { setMailAccountAddress } from '../flow/agent/connectors/mailContract';
import { prepareAttachmentCall } from '../mcp/agentAttachmentGuard';
import { connectInProcess, type InProcessConnection } from '../mcp/inProcessServer';
import type { CallVerdict } from '../thunderbird/attachmentPolicy';
import { defaultMailAccount, usableMailAccounts, type MailAccount, type MailAccountsSource } from './mailAccount';
import { createMailConnector, type MailConnector } from './mailClient';
import { composeRaw, mailOptions } from './mailCompose';
import { microsoftTokens, openMailImap, openMailSmtp } from './mailSignIn';
import { createMailMcpServer, normalizeAttachmentArgs } from './mailMcpServer';
import type { AddressLike } from './mailMessage';
import { createMailService, MailToolError, type MailAccountRef, type MailService, type ParsedMail } from './mailService';

/** Larger attachments are left in the mailbox: most mail services cap a message at 25 MB anyway. */
export const ATTACHMENT_SAVE_MAX_BYTES = 50 * 1024 * 1024;

function mailSource(): MailAccountsSource {
  return { mailAccounts: config.mailAccounts, mailDefaultId: config.mailDefaultId };
}

function accountById(id: string): MailAccount | null {
  return usableMailAccounts(mailSource()).find((account) => account.id === id) ?? null;
}

/** Microsoft's own SMTP hosts (Outlook.com, Microsoft 365) save every sent message in Sent. */
const MICROSOFT_SMTP_HOSTS = /(^|\.)(outlook\.com|office365\.com)$/i;

export function serverFilesSent(account: MailAccount): boolean {
  return account.auth === 'microsoft' || MICROSOFT_SMTP_HOSTS.test(account.smtp.host.trim());
}

/** Every usable account, the default first: what the service picks when nothing is named. */
export function mailAccountRefs(): MailAccountRef[] {
  const usable = usableMailAccounts(mailSource());
  const first = defaultMailAccount(mailSource());
  const ordered = first ? [first, ...usable.filter((account) => account.id !== first.id)] : usable;
  return ordered.map((account) => ({
    id: account.id, address: account.address, canRead: account.imap !== null, serverFilesSent: serverFilesSent(account),
  }));
}

const connectors = new Map<string, MailConnector>();
let service: MailService | null = null;

// The confirmation dialog names the account a draft or a mail goes out from when nothing else does.
setMailAccountAddress(
  () => defaultMailAccount(mailSource())?.address ?? '',
  (id) => accountById(id)?.address ?? '',
);

/** One IMAP connection per account, made on first use. */
function connectorFor(accountId: string): MailConnector {
  let connector = connectors.get(accountId);
  if (!connector) {
    connector = createMailConnector({ account: () => accountById(accountId), open: openMailImap });
    connectors.set(accountId, connector);
  }
  return connector;
}

function addresses(value: AddressObject | AddressObject[] | undefined): AddressLike[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.flatMap((entry) => entry.value.flatMap((address) => address.group ?? [address]));
}

export async function parseMail(raw: Buffer): Promise<ParsedMail> {
  const { simpleParser } = await import('mailparser');
  const parsed = await simpleParser(raw, { skipImageLinks: true, skipTextLinks: true });
  return {
    from: addresses(parsed.from),
    to: addresses(parsed.to),
    cc: addresses(parsed.cc),
    replyTo: addresses(parsed.replyTo),
    subject: parsed.subject,
    date: parsed.date,
    text: parsed.text ?? '',
    messageId: parsed.messageId,
    references: parsed.references,
    attachments: parsed.attachments.map((part) => ({
      filename: part.filename, size: part.size, contentType: part.contentType, content: part.content,
    })),
  };
}

/**
 * Mail-borne types beyond the shared download list: macro-enabled Office files, OneNote and the
 * script containers phishing mail favours. Opening one is the attack, so they stay in the mailbox.
 */
const MAIL_BLOCKED_EXTENSIONS: ReadonlySet<string> = new Set([
  'docm', 'dotm', 'xlsm', 'xltm', 'xlam', 'pptm', 'potm', 'ppam', 'one', 'onepkg', 'hta', 'wsc', 'sct',
]);

/**
 * Windows' "came from the internet" mark (Mark of the Web): Office opens such a file in Protected
 * View and SmartScreen checks it before it runs. Best effort; other systems have no such stream.
 */
async function markFromInternet(file: string): Promise<void> {
  if (process.platform !== 'win32') return;
  await fs.writeFile(`${file}:Zone.Identifier`, '[ZoneTransfer]\r\nZoneId=3\r\n').catch(() => {});
}

/**
 * Same rules as `file_download` — no programs, scripts or archives, judged by the name it will be
 * saved under and by its first bytes — plus the mail-borne types above.
 */
export async function saveMailAttachment(name: string, content: Buffer): Promise<string> {
  const safeName = sanitizeDownloadName(name) || 'attachment';
  if (isRunnableName(safeName) || MAIL_BLOCKED_EXTENSIONS.has(declaredExtension(safeName))
    || looksLikeProgram(content.subarray(0, PROGRAM_SNIFF_BYTES))) {
    throw new MailToolError(`Yobi does not save programs, scripts or archives (${safeName}); the user can open it from their mail app`);
  }
  if (content.length > ATTACHMENT_SAVE_MAX_BYTES) {
    throw new MailToolError(`"${safeName}" is larger than 50 MB; the user can save it from their mail app`);
  }
  const temp = path.join(os.tmpdir(), `yobi-mail-${randomUUID()}`);
  await fs.writeFile(temp, content);
  try {
    const saved = await saveIntoFolder(temp, yobiDownloadsDir(), safeName);
    await markFromInternet(saved);
    return saved;
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {});
  }
}

function mailService(): MailService {
  service ??= createMailService({
    accounts: mailAccountRefs,
    backend: (accountId) => connectorFor(accountId).backend(),
    compose: composeRaw,
    send: async (accountId, mail) => {
      const account = accountById(accountId);
      if (!account) throw new MailToolError('That mail account is no longer set up');
      const transport = await openMailSmtp(account);
      try {
        await transport.sendMail(mailOptions(mail));
      } finally {
        transport.close();
      }
    },
    parse: parseMail,
    saveFile: saveMailAttachment,
    now: () => new Date(),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  return service;
}

/** The flow step reads through the same service, connection and parser as the connector. */
export function sharedMailService(): MailService {
  return mailService();
}

export async function connectMailMcp(clientName: string, clientVersion: string): Promise<InProcessConnection> {
  return connectInProcess(createMailMcpServer(mailService()), clientName, clientVersion);
}

export function prepareMailCall(args: Record<string, unknown>): Promise<CallVerdict> {
  const normalized = normalizeAttachmentArgs(args);
  return 'denied' in normalized ? Promise.resolve(normalized) : prepareAttachmentCall(normalized.args);
}

/**
 * Drops IMAP connections: one account's (it was removed or signed in again), or all (the connector
 * was switched off). A removed or re-signed Microsoft mailbox also drops its cached access token.
 */
export async function closeMailConnection(accountId?: string): Promise<void> {
  const ids = accountId ? [accountId] : [...connectors.keys()];
  if (accountId) microsoftTokens.forget(accountId);
  for (const id of ids) {
    await connectors.get(id)?.close();
    connectors.delete(id);
  }
}
