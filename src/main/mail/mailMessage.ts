/**
 * Turns what the IMAP client and the MIME parser return into the compact shapes the model and the
 * flow step read: addresses as one string, times in the host zone, the body cut to a budget with
 * the cut said out loud, and attachments listed by name — never their bytes.
 */
import { localIsoString } from '../../shared/localTime';

export const BODY_MAX_CHARS = 8_000;

export interface AddressLike {
  name?: string;
  address?: string;
}

export interface MailSummaryInput {
  id: string;
  from?: readonly AddressLike[];
  replyTo?: readonly AddressLike[];
  to?: readonly AddressLike[];
  subject?: string;
  date?: Date;
  unread: boolean;
  starred: boolean;
  attachments: number;
  labels?: readonly string[];
}

/** One line of a search result. Flags and counts are left out when they are off or zero. */
export interface MailSummary {
  id: string;
  /** With several mailboxes searched together: the one that received it. */
  account?: string;
  from: string;
  /** Only when replies go somewhere other than `from`. */
  reply_to?: string;
  to?: string;
  subject: string;
  date: string;
  unread?: true;
  starred?: true;
  attachments?: number;
  labels?: string[];
}

export interface ParsedAttachmentLike {
  filename?: string;
  size?: number;
  contentType?: string;
}

export interface ParsedMailLike {
  from?: readonly AddressLike[];
  replyTo?: readonly AddressLike[];
  to?: readonly AddressLike[];
  cc?: readonly AddressLike[];
  subject?: string;
  date?: Date;
  text?: string;
  attachments?: readonly ParsedAttachmentLike[];
}

export interface MailAttachmentInfo {
  index: number;
  name: string;
  size: number;
  type: string;
}

export interface MailDetail {
  id: string;
  from: string;
  /** Only when replies go somewhere other than `from`. */
  reply_to?: string;
  to: string;
  cc?: string;
  subject: string;
  date: string;
  body: string;
  /** Set when `body` was cut; the rest of the message was not read. */
  truncated?: { shown_chars: number; total_chars: number };
  attachments?: MailAttachmentInfo[];
}

/** "Re: " once, whatever the original already had (Re:, RE:, 回覆:). */
export function replySubject(subject: string | undefined): string {
  const bare = (subject ?? '').trim();
  return /^(re|回覆|回复)\s*[:：]/i.test(bare) ? bare : `Re: ${bare}`.trim();
}

export function formatAddress(entry: AddressLike): string {
  const address = (entry.address ?? '').trim();
  const name = (entry.name ?? '').trim();
  if (name && address && name !== address) return `${name} <${address}>`;
  return address || name;
}

export function formatAddresses(list: readonly AddressLike[] | undefined): string {
  return (list ?? []).map(formatAddress).filter(Boolean).join(', ');
}

/**
 * The Reply-To written out when it points somewhere other than the sender, else ''. A reply goes
 * there, so it has to be visible: phishing sets From to the boss and Reply-To to itself.
 */
export function divergentReplyTo(from: readonly AddressLike[] | undefined, replyTo: readonly AddressLike[] | undefined): string {
  const addresses = (list: readonly AddressLike[] | undefined) => new Set((list ?? []).map((a) => (a.address ?? '').trim().toLowerCase()).filter(Boolean));
  const target = addresses(replyTo);
  if (target.size === 0) return '';
  const sender = addresses(from);
  const same = target.size === sender.size && [...target].every((address) => sender.has(address));
  return same ? '' : formatAddresses(replyTo);
}

function dateText(date: Date | undefined): string {
  return date && !Number.isNaN(date.getTime()) ? localIsoString(date) : '';
}

export function toMailSummary(input: MailSummaryInput): MailSummary {
  const summary: MailSummary = {
    id: input.id,
    from: formatAddresses(input.from),
    subject: (input.subject ?? '').trim(),
    date: dateText(input.date),
  };
  const replyTo = divergentReplyTo(input.from, input.replyTo);
  if (replyTo) summary.reply_to = replyTo;
  const to = formatAddresses(input.to);
  if (to) summary.to = to;
  if (input.unread) summary.unread = true;
  if (input.starred) summary.starred = true;
  if (input.attachments > 0) summary.attachments = input.attachments;
  if (input.labels && input.labels.length > 0) summary.labels = [...input.labels];
  return summary;
}

/** Line endings unified, trailing spaces dropped, runs of blank lines folded to one. */
export function cleanBody(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function clipBody(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: text.slice(0, max), truncated: true };
}

/** Real attachments only: inline images that a signature or HTML body shows have no filename. */
export function listAttachments(parsed: ParsedMailLike): MailAttachmentInfo[] {
  return (parsed.attachments ?? [])
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => Boolean(part.filename?.trim()))
    .map(({ part, index }) => ({
      index,
      name: part.filename!.trim(),
      size: part.size ?? 0,
      type: part.contentType ?? 'application/octet-stream',
    }));
}

export function toMailDetail(id: string, parsed: ParsedMailLike, maxChars: number = BODY_MAX_CHARS): MailDetail {
  const full = cleanBody(parsed.text ?? '');
  const clipped = clipBody(full, maxChars);
  const detail: MailDetail = {
    id,
    from: formatAddresses(parsed.from),
    to: formatAddresses(parsed.to),
    subject: (parsed.subject ?? '').trim(),
    date: dateText(parsed.date),
    body: clipped.text,
  };
  const replyTo = divergentReplyTo(parsed.from, parsed.replyTo);
  if (replyTo) detail.reply_to = replyTo;
  const cc = formatAddresses(parsed.cc);
  if (cc) detail.cc = cc;
  if (clipped.truncated) detail.truncated = { shown_chars: clipped.text.length, total_chars: full.length };
  const attachments = listAttachments(parsed);
  if (attachments.length > 0) detail.attachments = attachments;
  return detail;
}

/** The MIME tree IMAP's BODYSTRUCTURE returns, as much of it as counting attachments needs. */
export interface BodyStructureLike {
  type?: string;
  disposition?: string;
  dispositionParameters?: Record<string, string>;
  parameters?: Record<string, string>;
  childNodes?: readonly BodyStructureLike[];
}

export function countAttachments(node: BodyStructureLike | undefined): number {
  if (!node) return 0;
  if (node.childNodes && node.childNodes.length > 0) {
    return node.childNodes.reduce((sum, child) => sum + countAttachments(child), 0);
  }
  const named = Boolean(node.dispositionParameters?.filename || node.parameters?.name);
  return node.disposition?.toLowerCase() === 'attachment' || (named && node.disposition?.toLowerCase() !== 'inline') ? 1 : 0;
}
