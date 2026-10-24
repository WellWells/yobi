/**
 * The IMAP side of the Mail connector: one imapflow connection per account, opened on the first
 * call, shared by every call after it and closed after a quiet spell. imapflow never reconnects
 * by itself and an instance connects only once, so a dropped connection is simply forgotten and
 * the next call opens a fresh one.
 */
import type { FetchMessageObject, ImapFlow, ListResponse } from 'imapflow';
import { canReadMail, mailAccountKey, type MailAccount } from './mailAccount';
import type { MailBackend, MailFolder, OpenFolder, RawMessage, SpecialUse } from './mailBackend';
import type { BodyStructureLike } from './mailMessage';

export const MAIL_IDLE_CLOSE_MS = 5 * 60_000;

/** The account is missing or cannot read mail; the message says which, for the model and the log. */
export class MailSetupError extends Error {
  constructor(readonly reason: 'noAccount' | 'sendOnly', message: string) {
    super(message);
    this.name = 'MailSetupError';
  }
}

const SPECIAL_USES: ReadonlySet<string> = new Set(['\\Inbox', '\\All', '\\Archive', '\\Drafts', '\\Flagged', '\\Junk', '\\Sent', '\\Trash']);

function toFolder(entry: ListResponse): MailFolder {
  return {
    path: entry.path,
    name: entry.name,
    ...(entry.specialUse && SPECIAL_USES.has(entry.specialUse) ? { specialUse: entry.specialUse as SpecialUse } : {}),
    ...(entry.status?.unseen !== undefined ? { unread: entry.status.unseen } : {}),
    ...(entry.status?.messages !== undefined ? { total: entry.status.messages } : {}),
  };
}

/**
 * Gmail marks a draft with its `\Draft` label rather than the IMAP flag when the message is opened
 * outside the Drafts folder (All Mail, where every Gmail id is looked up): the label is turned into
 * the flag here, because system labels are dropped from `labels` (2026-10-23, live: a real Gmail
 * draft sent with `draft_id` was left behind as "not a draft").
 */
export function toRaw(message: FetchMessageObject): RawMessage {
  const envelope = message.envelope;
  const flags = [...(message.flags ?? [])];
  if (message.labels?.has('\\Draft') && !flags.includes('\\Draft')) flags.push('\\Draft');
  return {
    uid: message.uid,
    ...(message.emailId ? { emailId: message.emailId } : {}),
    ...(envelope?.messageId ? { messageId: envelope.messageId } : {}),
    from: envelope?.from ?? [],
    replyTo: envelope?.replyTo ?? [],
    to: envelope?.to ?? [],
    subject: envelope?.subject ?? '',
    ...(envelope?.date ? { date: new Date(envelope.date) } : {}),
    flags,
    ...(message.labels ? { labels: [...message.labels].filter((label) => !label.startsWith('\\')) } : {}),
    ...(message.bodyStructure ? { bodyStructure: message.bodyStructure as BodyStructureLike } : {}),
    ...(message.size !== undefined ? { size: message.size } : {}),
  };
}

function range(uids: readonly number[]): string {
  return uids.join(',');
}

export function createImapBackend(client: ImapFlow): MailBackend {
  const gmail = client.capabilities.has('X-GM-EXT-1');
  return {
    gmail,
    async folders(withCounts) {
      const list = await client.list(withCounts ? { statusQuery: { messages: true, unseen: true } } : undefined);
      return list.filter((entry) => !entry.flags.has('\\Noselect') && !entry.flags.has('\\NonExistent')).map(toFolder);
    },
    async withFolder(path, work) {
      const lock = await client.getMailboxLock(path);
      try {
        const mailbox = client.mailbox;
        const open: OpenFolder = {
          path,
          uidValidity: mailbox ? String(mailbox.uidValidity) : '',
          search: async (criteria) => {
            const found = await client.search(criteria, { uid: true });
            return Array.isArray(found) ? found : [];
          },
          fetch: async (uids) => {
            if (uids.length === 0) return [];
            const fetched = await client.fetchAll(range(uids), {
              uid: true, flags: true, envelope: true, bodyStructure: true, size: true,
              ...(gmail ? { emailId: true, labels: true } : {}),
            }, { uid: true });
            return fetched.map(toRaw);
          },
          ...(gmail ? {
            emailIds: async (uids: readonly number[]) => {
              if (uids.length === 0) return [];
              const fetched = await client.fetchAll(range(uids), { uid: true, emailId: true }, { uid: true });
              return fetched.map((message) => ({ uid: message.uid, ...(message.emailId ? { emailId: message.emailId } : {}) }));
            },
          } : {}),
          source: async (uid) => {
            const fetched = await client.fetchOne(String(uid), { source: true }, { uid: true });
            return fetched && fetched.source ? fetched.source : null;
          },
          addFlags: async (uids, flags) => { await client.messageFlagsAdd(range(uids), [...flags], { uid: true }); },
          removeFlags: async (uids, flags) => { await client.messageFlagsRemove(range(uids), [...flags], { uid: true }); },
          addLabels: async (uids, labels) => { await client.messageFlagsAdd(range(uids), [...labels], { uid: true, useLabels: true }); },
          removeLabels: async (uids, labels) => { await client.messageFlagsRemove(range(uids), [...labels], { uid: true, useLabels: true }); },
          move: async (uids, destination) => { await client.messageMove(range(uids), destination, { uid: true }); },
        };
        return await work(open);
      } finally {
        lock.release();
      }
    },
    async append(path, raw, flags) {
      const result = await client.append(path, raw, [...flags]);
      if (!result) return {};
      return {
        ...(result.uid !== undefined ? { uid: result.uid } : {}),
        ...(result.uidValidity !== undefined ? { uidValidity: String(result.uidValidity) } : {}),
      };
    },
  };
}

/** Signs in to the account's IMAP server; TLS throughout, the password never in cleartext. */
/** `accessToken` signs in with XOAUTH2 (a Microsoft account) instead of the password. */
export async function openImapClient(account: MailAccount & { imap: { host: string; port: number } }, accessToken?: string): Promise<ImapFlow> {
  const { ImapFlow } = await import('imapflow');
  const implicitTls = account.imap.port === 993;
  const client = new ImapFlow({
    host: account.imap.host,
    port: account.imap.port,
    secure: implicitTls,
    ...(implicitTls ? {} : { doSTARTTLS: true }),
    auth: accessToken ? { user: account.address, accessToken } : { user: account.address, pass: account.password },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 30_000,
    greetingTimeout: 15_000,
    socketTimeout: 120_000,
  });
  // Without a listener an error after connect() (a socket timeout) is an uncaught exception.
  client.on('error', () => {});
  await client.connect();
  return client;
}

export interface MailConnectorDeps {
  account: () => MailAccount | null;
  open: (account: MailAccount & { imap: { host: string; port: number } }) => Promise<ImapFlow>;
  idleCloseMs?: number;
}

export interface MailConnector {
  backend: () => Promise<MailBackend>;
  close: () => Promise<void>;
}

export function createMailConnector(deps: MailConnectorDeps): MailConnector {
  const idleMs = deps.idleCloseMs ?? MAIL_IDLE_CLOSE_MS;
  let live: { key: string; client: ImapFlow; backend: MailBackend } | null = null;
  let opening: { key: string; promise: Promise<MailBackend> } | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  // Bumped by every new sign-in and by close(): a sign-in that finishes after it was superseded (the
  // account changed meanwhile, or the connector was switched off) logs out instead of staying.
  let generation = 0;

  function drop(client: ImapFlow): void {
    if (live?.client === client) live = null;
    client.logout().catch(() => client.close());
  }

  function armIdle(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (live) drop(live.client);
    }, idleMs);
  }

  async function backend(): Promise<MailBackend> {
    const account = deps.account();
    if (!account) throw new MailSetupError('noAccount', 'No mail account is set up. The user adds one in Settings › Connectors › Mail.');
    if (!canReadMail(account)) {
      throw new MailSetupError('sendOnly', 'This mail account can only send (no IMAP server). The user adds one in Settings › Connectors › Mail.');
    }
    const key = mailAccountKey(account);
    armIdle();
    if (live && live.key === key && live.client.usable) return live.backend;
    if (live) drop(live.client);
    if (opening && opening.key === key) return opening.promise;
    const mine = ++generation;
    const promise = deps.open(account).then((client) => {
      if (mine !== generation) {
        client.logout().catch(() => client.close());
        throw new Error('The mail connection was replaced or closed while signing in; try again');
      }
      const created = { key, client, backend: createImapBackend(client) };
      client.on('close', () => {
        if (live?.client === client) live = null;
      });
      live = created;
      armIdle();
      return created.backend;
    });
    opening = { key, promise };
    try {
      return await promise;
    } finally {
      if (opening?.promise === promise) opening = null;
    }
  }

  async function close(): Promise<void> {
    generation++;
    opening = null;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    if (live) drop(live.client);
  }

  return { backend, close };
}
