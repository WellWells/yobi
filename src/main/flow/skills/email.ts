import { createTransport } from 'nodemailer';
import { config } from '../../config';
import { sendLog } from '../../helpers';

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

  const transporter = createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.password },
  });

  try {
    await transporter.sendMail({
      from: fromName ? `${fromName} <${smtp.user}>` : smtp.user,
      to,
      subject,
      text: body,
    });
    sendLog(`✉️ [AgentFlow] Email sent to: ${to}`);
    return '';
  } catch (err) {
    throw new Error(`email_send: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    transporter.close();
  }
}
