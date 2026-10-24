/**
 * Builds outgoing mail once for both callers: the flow's email step and the Mail connector's draft
 * and send tools. Markdown becomes the HTML part with the markdown kept as the plain-text part; a
 * reply carries In-Reply-To and References so mail clients file it under the original thread.
 */
import { createTransport, type Transporter } from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import type { MailComposerOptions } from 'nodemailer/lib/mail-composer';
import type { SmtpConfig } from '../configTypes';
import { renderEmailHtml } from '../flow/skills/emailHtml';

export interface ReplyContext {
  messageId?: string;
  references?: string | readonly string[];
  subject?: string;
}

export interface OutgoingMail {
  from: string;
  fromName?: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  /** Markdown; usually written by a model. */
  body: string;
  attachments?: readonly { path: string }[];
  replyTo?: ReplyContext;
  /** Set when the message was composed before (a saved copy) and must keep the same id. */
  messageId?: string;
}

/** `accessToken` signs in with XOAUTH2 (a Microsoft account) instead of the password. */
export function createSmtpTransport(smtp: SmtpConfig, accessToken?: string): Transporter {
  return createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    // Off 465 the connection starts in cleartext: refuse to sign in unless it upgrades to TLS,
    // so the password never crosses the wire unencrypted.
    requireTLS: smtp.port !== 465,
    auth: accessToken ? { type: 'OAuth2', user: smtp.user, accessToken } : { user: smtp.user, pass: smtp.password },
    // Forced onto every message: even if an interpolated {{variable}} or a model's argument lands
    // something URL-shaped in a content field, nodemailer must not go and fetch it from here.
    disableUrlAccess: true,
  });
}

export { replySubject } from './mailMessage';

function referenceList(value: string | readonly string[] | undefined): string[] {
  if (!value) return [];
  const list = typeof value === 'string' ? value.split(/\s+/) : [...value];
  return list.map((id) => id.trim()).filter(Boolean);
}

/** The original's own references followed by its Message-ID, without repeats. */
export function replyReferences(original: ReplyContext): string[] {
  const ids = [...referenceList(original.references), ...referenceList(original.messageId)];
  return [...new Set(ids)];
}

export function mailOptions(mail: OutgoingMail): MailComposerOptions {
  const html = mail.body.trim() ? renderEmailHtml(mail.body) : '';
  const options: MailComposerOptions = {
    from: mail.fromName ? { name: mail.fromName, address: mail.from } : mail.from,
    to: mail.to,
    subject: mail.subject,
    text: mail.body,
    disableUrlAccess: true,
    ...(html ? { html } : {}),
    ...(mail.messageId ? { messageId: mail.messageId } : {}),
    ...(mail.cc ? { cc: mail.cc } : {}),
    ...(mail.bcc ? { bcc: mail.bcc } : {}),
    ...(mail.attachments && mail.attachments.length > 0 ? { attachments: mail.attachments.map(({ path }) => ({ path })) } : {}),
  };
  if (mail.replyTo?.messageId) {
    options.inReplyTo = mail.replyTo.messageId;
    options.references = replyReferences(mail.replyTo);
  }
  return options;
}

export interface ComposedMail {
  raw: Buffer;
  messageId: string;
}

/** The message as a draft or as sent: Bcc kept in the headers so a saved draft still has it. */
export async function composeRaw(mail: OutgoingMail): Promise<ComposedMail> {
  const node = new MailComposer(mailOptions(mail)).compile();
  node.keepBcc = true;
  const raw = await node.build();
  return { raw, messageId: node.messageId() };
}
