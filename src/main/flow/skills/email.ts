import * as fs from 'node:fs/promises';
import { createTransport } from 'nodemailer';
import { config } from '../../config';
import { parseAttachmentList, resolveSafeLocalAttachment } from '../../attachmentGuard';
import { sendLog } from '../../helpers';
import { isSmtpAccountComplete } from '../../smtpAccount';
import { FlowUserError } from '../userError';
import { renderEmailHtml } from './emailHtml';

/**
 * Resolves the step's attachments to local paths this run may send, using the same
 * `resolveSafeLocalAttachment` gate as the bot and llm steps. Local files only: nodemailer would
 * fetch a URL `path` from this machine. A refused file throws rather than sending the mail without it.
 */
async function resolveMailAttachments(
  raw: string | undefined,
  allowlistJson: string | undefined,
): Promise<{ path: string }[]> {
  const candidates = parseAttachmentList(raw);
  if (candidates.length === 0) return [];

  let authorizedPaths: string[] = [];
  try {
    const parsed: unknown = JSON.parse(allowlistJson ?? '[]');
    if (Array.isArray(parsed)) authorizedPaths = parsed.filter((v): v is string => typeof v === 'string');
  } catch {}

  const resolved: { path: string }[] = [];
  for (const candidate of candidates) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
      throw new FlowUserError(
        'flow.error.attachmentUrl',
        { url: candidate },
        `email_send: attachments takes local file paths, not URLs (${candidate}) — download it with a file_download step first and attach {{file}}`,
      );
    }
    try {
      const filePath = await resolveSafeLocalAttachment(candidate, authorizedPaths);
      // The guard checks permission, not existence; check here so a missing file is reported by name.
      await fs.access(filePath, fs.constants.R_OK);
      resolved.push({ path: filePath });
    } catch (err) {
      throw new FlowUserError(
        'flow.error.attachmentRefused',
        { file: candidate },
        `email_send: attachment "${candidate}" was refused — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return resolved;
}

export async function execEmailSend(skillConfig: Record<string, string>): Promise<string> {
  const to = (skillConfig.to ?? '').trim();
  const subject = skillConfig.subject ?? '';
  const body = skillConfig.body ?? '';
  const fromName = (skillConfig.fromName ?? '').trim();

  if (!to || !subject) {
    throw new FlowUserError('flow.error.emailFields', {}, 'email_send: requires "to" and "subject"');
  }

  // The SMTP form lives on the email step itself (shared by every email step); Settings has none.
  const smtp = config.smtp;
  if (!isSmtpAccountComplete(smtp)) {
    throw new FlowUserError(
      'flow.error.smtpMissing',
      {},
      'email_send: SMTP not configured — fill in the SMTP account on the email step',
    );
  }

  const attachments = await resolveMailAttachments(skillConfig.attachments, skillConfig.__attachmentAllowlist);
  // The body is markdown (usually an llm step's answer). The formatted HTML is what a mail client
  // shows; the markdown itself stays as the plain-text part for clients that do not render HTML.
  const html = body.trim() ? renderEmailHtml(body) : '';

  const transporter = createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.password },
    // Forced onto every message: even if an interpolated {{variable}} lands something
    // URL-shaped in a content field, nodemailer must not go and fetch it from here.
    disableUrlAccess: true,
  });

  try {
    await transporter.sendMail({
      from: fromName ? `${fromName} <${smtp.user}>` : smtp.user,
      to,
      subject,
      text: body,
      ...(html ? { html } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
    });
    const withFiles = attachments.length > 0 ? ` (${attachments.length} attachment(s))` : '';
    sendLog(`✉️ [Flow] Email sent to: ${to}${withFiles}`);
    return '';
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new FlowUserError('flow.error.emailSendFailed', { error: detail }, `email_send: ${detail}`);
  } finally {
    transporter.close();
  }
}
