import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import type { EmailSettingsSnapshot, SmtpCredentials } from '../../shared/types';
import { config, saveConfig } from '../config';
import { maskToken, sendLog } from '../helpers';

export function registerEmailHandlers(): void {
  ipcMain.handle(IPC.GET_EMAIL_SETTINGS, (): EmailSettingsSnapshot => ({
    enabled: config.smtp.enabled,
    host: config.smtp.host,
    port: config.smtp.port,
    user: config.smtp.user,
    hasPassword: Boolean(config.smtp.password.trim()),
    passwordPreview: maskToken(config.smtp.password),
  }));

  ipcMain.handle(IPC.UPDATE_EMAIL_ENABLED, (_event, enabled: boolean) => {
    config.smtp.enabled = Boolean(enabled);
    saveConfig({ smtp: config.smtp });
    sendLog(`Email SMTP ${config.smtp.enabled ? 'enabled' : 'disabled'}`);
    return { ok: true as const };
  });

  ipcMain.handle(IPC.UPDATE_EMAIL_CREDENTIALS, (_event, creds: SmtpCredentials) => {
    config.smtp.host = (creds?.host ?? '').trim();
    config.smtp.port = Number(creds?.port) || 587;
    config.smtp.user = (creds?.user ?? '').trim();
    if (creds?.password) config.smtp.password = creds.password;
    saveConfig({ smtp: config.smtp });
    sendLog('Email SMTP credentials updated');
    return { ok: true as const };
  });
}
