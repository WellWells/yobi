import * as fs from 'node:fs/promises';
import { config } from '../../config';
import { parseAttachmentList, resolveSafeLocalAttachment } from '../../attachmentGuard';
import { sendLog } from '../../helpers';
import { findMailAccount } from '../../mail/mailAccount';
import { FlowUserError } from '../userError';
import { mailOptions } from '../../mail/mailCompose';
import { openMailSmtp } from '../../mail/mailSignIn';

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

  // The mail accounts are entered on the Mail connector card (Settings › Connectors › Mail); the
  // step names one by address or id, blank = the default. A named account that is gone is an
  // error — never a silent switch to another sender.
  const wanted = (skillConfig.account ?? '').trim();
  const account = findMailAccount({ mailAccounts: config.mailAccounts ?? [], mailDefaultId: config.mailDefaultId ?? '' }, wanted);
  if (!account) {
    if (wanted) {
      throw new FlowUserError('flow.error.mailAccountUnknown', { account: wanted }, `email_send: no mail account "${wanted}" in Settings › Connectors › Mail`);
    }
    throw new FlowUserError(
      'flow.error.smtpMissing',
      {},
      'email_send: no mail account — set one in Settings › Connectors › Mail',
    );
  }
  const smtp = account.smtp;

  const attachments = await resolveMailAttachments(skillConfig.attachments, skillConfig.__attachmentAllowlist);
  // The body is markdown (usually an llm step's answer): the Mail connector builds its drafts
  // and sends through the same composer, so both look the same in the recipient's client.
  let transporter: Awaited<ReturnType<typeof openMailSmtp>>;
  try {
    transporter = await openMailSmtp(account);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new FlowUserError('flow.error.emailSendFailed', { error: detail }, `email_send: ${detail}`);
  }

  try {
    await transporter.sendMail(mailOptions({ from: smtp.user, fromName, to, subject, body, attachments }));
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
