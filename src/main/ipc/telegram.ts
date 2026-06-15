import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import { config, saveConfig } from '../config';
import { normalizeProviderCommands } from '../configNormalizers';
import { sendLog } from '../helpers';
import { buildTelegramSettingsSnapshot } from '../telegramBridge';
import { issuePairingCode, revokePairingCode, unpairUser } from '../telegram';
import type { IpcContext } from './context';

function registerSyncSetting(
  ctx: IpcContext,
  channel: string,
  mutate: (value: unknown) => void,
  messages: { success?: (value: unknown) => string; failure: string },
): void {
  ipcMain.handle(channel, async (_event, value: unknown) => {
    mutate(value);
    saveConfig({ telegram: config.telegram });
    try {
      await ctx.telegramRuntime.syncWithConfig();
      if (messages.success) sendLog(messages.success(value));
      return true;
    } catch (err: unknown) {
      sendLog(`⚠️ ${messages.failure}: ${(err as Error).message}`);
      return false;
    }
  });
}

export function registerTelegramHandlers(ctx: IpcContext): void {
  ipcMain.handle(IPC.GET_TELEGRAM_SETTINGS, () => buildTelegramSettingsSnapshot());

  registerSyncSetting(
    ctx,
    IPC.UPDATE_TELEGRAM_ENABLED,
    (value) => { config.telegram.enabled = Boolean(value); },
    {
      success: () => `Telegram bot ${config.telegram.enabled ? 'enabled' : 'disabled'}`,
      failure: 'Failed to update Telegram runtime',
    },
  );

  ipcMain.handle(IPC.UPDATE_TELEGRAM_BOT_TOKEN, async (_event, token: string) => {
    const nextToken = (token ?? '').trim();
    config.telegram.botToken = nextToken;
    saveConfig({ telegram: config.telegram });
    if (!config.telegram.enabled) {
      sendLog(`Telegram bot token ${nextToken ? 'updated' : 'cleared'}`);
      return { ok: true as const };
    }
    try {
      await ctx.telegramRuntime.syncWithConfig();
      sendLog('Telegram bot token updated');
      return { ok: true as const };
    } catch (err: unknown) {
      const message = (err as Error).message;
      sendLog(`⚠️ Telegram token update failed: ${message}`);
      return { ok: false as const, message };
    }
  });

  registerSyncSetting(
    ctx,
    IPC.UPDATE_TELEGRAM_ALLOW_GROUP_COMMANDS,
    (value) => { config.telegram.allowGroupCommands = Boolean(value); },
    { failure: 'Failed to update Telegram group setting' },
  );

  ipcMain.handle(IPC.UPDATE_TELEGRAM_DEFAULT_REPLY_MODE, (_event, mode: 'markdown' | 'png' | 'webp' | 'pdf') => {
    if (mode !== 'markdown' && mode !== 'png' && mode !== 'webp' && mode !== 'pdf') return false;
    config.telegram.defaultReplyMode = mode;
    saveConfig({ telegram: config.telegram });
    return true;
  });

  ipcMain.handle(IPC.UPDATE_TELEGRAM_ADMIN_USERS, (_event, userIds: number[]) => {
    const pairedUserIds = new Set(config.telegram.pairing.pairedUsers.map((item) => item.userId));
    const normalized = Array.isArray(userIds)
      ? [...new Set(
        userIds
          .map((value) => Number(value))
          .filter((userId) => Number.isFinite(userId) && userId > 0 && pairedUserIds.has(userId)),
      )]
      : [];
    config.telegram.adminUserIds = normalized;
    saveConfig({ telegram: config.telegram });
    return true;
  });

  ipcMain.handle(IPC.UPDATE_TELEGRAM_PROVIDER_COMMANDS, async (_event, value: unknown) => {
    config.telegram.providerCommands = normalizeProviderCommands(value);
    saveConfig({ telegram: config.telegram });
    try {
      await ctx.telegramRuntime.refreshBotCommands();
      return true;
    } catch (err: unknown) {
      sendLog(`⚠️ Failed to update Telegram provider commands: ${(err as Error).message}`);
      return false;
    }
  });

  ipcMain.handle(IPC.GENERATE_TELEGRAM_PAIRING_CODE, () => {
    const issued = issuePairingCode(config.telegram.pairing, ctx.telegramSessionId);
    config.telegram.pairing = issued.nextState;
    saveConfig({ telegram: config.telegram });
    sendLog(`Telegram pairing code generated (expires at ${issued.expiresAt})`);
    return { code: issued.code, expiresAt: issued.expiresAt };
  });

  ipcMain.handle(IPC.REVOKE_TELEGRAM_PAIRING_CODE, (_event, code: string) => {
    config.telegram.pairing = revokePairingCode(config.telegram.pairing, code);
    saveConfig({ telegram: config.telegram });
    return true;
  });

  ipcMain.handle(IPC.UNPAIR_TELEGRAM_USER, (_event, userId: number) => {
    const numericUserId = Number(userId);
    if (!Number.isFinite(numericUserId) || numericUserId <= 0) return false;
    config.telegram.pairing = unpairUser(config.telegram.pairing, numericUserId);
    config.telegram.adminUserIds = config.telegram.adminUserIds.filter((id) => id !== numericUserId);
    saveConfig({ telegram: config.telegram });
    return true;
  });
}
