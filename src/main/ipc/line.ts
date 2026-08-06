import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import type { LineCredentialsUpdate } from '../../shared/types';
import { config, saveConfig } from '../config';
import { normalizeLlmDirect } from '../configNormalizers';
import { sendLog } from '../helpers';
import { issueLinePairingCode, revokeLinePairingCode, unpairLineUser } from '../line';
import { buildLineSettingsSnapshot } from '../lineBridge';
import type { IpcContext } from './context';

export function registerLineHandlers(ctx: IpcContext): void {
  ipcMain.handle(IPC.GET_LINE_SETTINGS, () => buildLineSettingsSnapshot());

  ipcMain.handle(IPC.UPDATE_LINE_ENABLED, async (_event, value: unknown) => {
    config.line.enabled = Boolean(value);
    saveConfig({ line: config.line });
    try {
      await ctx.lineRuntime.syncWithConfig();
      sendLog(`LINE bot ${config.line.enabled ? 'enabled' : 'disabled'}`);
      return { ok: true as const };
    } catch (err: unknown) {
      const message = (err as Error).message;
      sendLog(`⚠️ Failed to update LINE runtime: ${message}`);
      return { ok: false as const, message };
    }
  });

  ipcMain.handle(IPC.UPDATE_LINE_CREDENTIALS, async (_event, creds: LineCredentialsUpdate) => {
    const nextToken = typeof creds?.channelAccessToken === 'string' ? creds.channelAccessToken.trim() : '';
    const nextSecret = typeof creds?.channelSecret === 'string' ? creds.channelSecret.trim() : '';
    if (nextToken) config.line.channelAccessToken = nextToken;
    if (nextSecret) config.line.channelSecret = nextSecret;
    saveConfig({ line: config.line });
    if (!config.line.enabled) {
      sendLog('LINE credentials updated');
      return { ok: true as const };
    }
    try {
      await ctx.lineRuntime.syncWithConfig();
      sendLog('LINE credentials updated');
      return { ok: true as const };
    } catch (err: unknown) {
      const message = (err as Error).message;
      sendLog(`⚠️ LINE credentials update failed: ${message}`);
      return { ok: false as const, message };
    }
  });

  ipcMain.handle(IPC.UPDATE_LINE_PORT, async (_event, value: unknown) => {
    const port = Number(value);
    if (!Number.isFinite(port) || port <= 0 || port > 65_535) {
      return { ok: false as const, message: 'invalid port' };
    }
    config.line.port = Math.floor(port);
    saveConfig({ line: config.line });
    try {
      await ctx.lineRuntime.syncWithConfig();
      return { ok: true as const };
    } catch (err: unknown) {
      const message = (err as Error).message;
      sendLog(`⚠️ LINE port update failed: ${message}`);
      return { ok: false as const, message };
    }
  });

  ipcMain.handle(IPC.UPDATE_LINE_LLM_DIRECT, (_event, value: unknown) => {
    config.line.llmDirect = normalizeLlmDirect(value);
    saveConfig({ line: config.line });
    return { ok: true as const, snapshot: buildLineSettingsSnapshot() };
  });

  ipcMain.handle(IPC.GENERATE_LINE_PAIRING_CODE, () => {
    const issued = issueLinePairingCode(config.line.pairing);
    config.line.pairing = issued.nextState;
    saveConfig({ line: config.line });
    sendLog(`LINE pairing code generated (expires at ${issued.expiresAt})`);
    return { ok: true as const, snapshot: buildLineSettingsSnapshot() };
  });

  ipcMain.handle(IPC.REVOKE_LINE_PAIRING_CODE, (_event, code: unknown) => {
    config.line.pairing = revokeLinePairingCode(config.line.pairing, String(code ?? ''));
    saveConfig({ line: config.line });
    return { ok: true as const, snapshot: buildLineSettingsSnapshot() };
  });

  ipcMain.handle(IPC.UNPAIR_LINE_USER, (_event, userId: unknown) => {
    config.line.pairing = unpairLineUser(config.line.pairing, String(userId ?? '').trim());
    saveConfig({ line: config.line });
    return { ok: true as const, snapshot: buildLineSettingsSnapshot() };
  });

  ipcMain.handle(IPC.REFRESH_LINE_ACCOUNT, async () => {
    try {
      await ctx.lineRuntime.refreshAccount();
      return { ok: true as const };
    } catch (err: unknown) {
      const message = (err as Error).message;
      sendLog(`⚠️ LINE account refresh failed: ${message}`);
      return { ok: false as const, message };
    }
  });
}
