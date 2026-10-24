/**
 * The handle the model passes back to read, reply to or move one message. IMAP addresses a message
 * by folder + UIDVALIDITY + UID; Gmail also gives every message one id across all its labels
 * (X-GM-MSGID), which survives the message being archived or relabelled.
 */

export class MailIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailIdError';
  }
}

export type MailRef =
  | { kind: 'gmail'; emailId: string }
  | { kind: 'imap'; folder: string; uidValidity: string; uid: number };

export function encodeMailId(ref: MailRef): string {
  if (ref.kind === 'gmail') return `g${ref.emailId}`;
  return `m${ref.uid}.${ref.uidValidity}.${Buffer.from(ref.folder, 'utf8').toString('base64url')}`;
}

/** The id the one account from before multiple mailboxes gets on upgrade. */
export const LEGACY_MAIL_ACCOUNT_ID = 'main';

/**
 * With several mailboxes a message id starts with its account's id: `<account>~<message>`. An id
 * without one comes from before multiple mailboxes, so it belongs to the upgraded account
 * (`LEGACY_MAIL_ACCOUNT_ID`) — never to whichever mailbox is the default now.
 */
export function qualifyMailId(accountId: string, messageId: string): string {
  return `${accountId}~${messageId}`;
}

export function splitMailId(id: string): { accountId: string | null; messageId: string } {
  const raw = id.trim();
  const tilde = raw.indexOf('~');
  return tilde > 0 ? { accountId: raw.slice(0, tilde), messageId: raw.slice(tilde + 1) } : { accountId: null, messageId: raw };
}

export function decodeMailId(id: string): MailRef {
  const raw = splitMailId(id).messageId;
  const gmail = /^g(\d+)$/.exec(raw);
  if (gmail) return { kind: 'gmail', emailId: gmail[1] };
  const imap = /^m(\d+)\.(\d+)\.([A-Za-z0-9_-]+)$/.exec(raw);
  if (imap) {
    const folder = Buffer.from(imap[3], 'base64url').toString('utf8');
    if (folder) return { kind: 'imap', folder, uidValidity: imap[2], uid: Number(imap[1]) };
  }
  throw new MailIdError(`"${id}" is not a message id from mail_search; search again and use an id from its results`);
}
