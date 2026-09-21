import * as fs from 'node:fs/promises';
import { createTransport } from 'nodemailer';
import { config } from '../../config';
import { parseAttachmentList, resolveSafeLocalAttachment } from '../../attachmentGuard';
import { sendLog } from '../../helpers';

/**
 * Resolves the step's attachment list to absolute paths this run is allowed to send.
 *
 * Same gate as the bot and llm steps — `resolveSafeLocalAttachment` against the files this run
 * produced plus the app's own output folder — rather than a second policy that would drift from
 * it. LOCAL FILES ONLY: nodemailer would happily treat a `path` as a URL and fetch it from this
 * machine, which turns an attachment field into a request forger aimed at localhost. Telegram
 * takes URLs because Telegram's servers do that fetching, not ours.
 *
 * A failure throws rather than sending the mail without the file. `email_send` has no
 * emitFailFlag and every other failure in it already aborts, and an email the user believes
 * carries an invoice is worse than a flow that stops and says why.
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
      throw new Error(`email_send: attachments takes local file paths, not URLs (${candidate}) — download it with a file_download step first and attach {{file}}`);
    }
    try {
      const filePath = await resolveSafeLocalAttachment(candidate, authorizedPaths);
      // The guard answers "may this be sent", not "is it there" — a path inside the output
      // folder passes it whether or not the file exists. Checking here means a typo or a
      // step that never ran is reported against the file name, instead of surfacing later as
      // a stream error from inside the mailer.
      await fs.access(filePath, fs.constants.R_OK);
      resolved.push({ path: filePath });
    } catch (err) {
      throw new Error(`email_send: attachment "${candidate}" was refused — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return resolved;
}

export async function execEmailSend(skillConfig: Record<string, string>): Promise<string> {
  const to = (skillConfig.to ?? '').trim();
  const subject = skillConfig.subject ?? '';
  const body = skillConfig.body ?? '';
  const fromName = (skillConfig.fromName ?? '').trim();

  if (!to || !subject) throw new Error('email_send: requires "to" and "subject"');

  const smtp = config.smtp;
  if (!smtp.host || !smtp.user || !smtp.password) {
    throw new Error('email_send: SMTP not configured — set it in Settings › Email');
  }

  const attachments = await resolveMailAttachments(skillConfig.attachments, skillConfig.__attachmentAllowlist);

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
      ...(attachments.length > 0 ? { attachments } : {}),
    });
    const withFiles = attachments.length > 0 ? ` (${attachments.length} attachment(s))` : '';
    sendLog(`✉️ [Flow] Email sent to: ${to}${withFiles}`);
    return '';
  } catch (err) {
    throw new Error(`email_send: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    transporter.close();
  }
}
