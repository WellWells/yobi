import { ipcMain } from 'electron';
import { IPC, SOCKET_BOT_SECRET_FIELDS, isSocketBotPlatform } from '../../shared/types';
import type { SocketBotActionResult, SocketBotPlatform, SocketBotSettingsSnapshot } from '../../shared/types';
import { config, saveConfig } from '../config';
import { normalizeLlmDirect } from '../configNormalizers';
import { sendLog } from '../helpers';
import {
  buildSocketBotSettingsSnapshot,
  issueSocketBotPairingCode,
  revokeSocketBotPairingCode,
  unpairSocketBotAccount,
} from '../socketBotBridge';
import type { IpcContext } from './context';

/*
 * Discord's and Slack's settings: one set of channels, each call naming its platform first. An
 * unknown platform is refused before anything is read or written.
 */

function platformOf(value: unknown): SocketBotPlatform | null {
  return typeof value === 'string' && isSocketBotPlatform(value) ? value : null;
}

function refused(): SocketBotActionResult {
  return { ok: false, message: 'unknown platform' };
}

export function registerSocketBotHandlers(ctx: IpcContext): void {
  /** Applies the config to the running bot; a failure to start is shown, not thrown. */
  async function sync(platform: SocketBotPlatform, what: string): Promise<SocketBotActionResult> {
    try {
      await ctx.socketBots[platform].syncWithConfig();
      sendLog(`${platform} ${what}`);
      return { ok: true, snapshot: buildSocketBotSettingsSnapshot(platform) };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      sendLog(`⚠️ ${platform} ${what} failed: ${message}`);
      return { ok: false, message, snapshot: buildSocketBotSettingsSnapshot(platform) };
    }
  }

  ipcMain.handle(IPC.SOCKET_BOT_GET_SETTINGS, (_event, raw: unknown): SocketBotSettingsSnapshot | null => {
    const platform = platformOf(raw);
    return platform ? buildSocketBotSettingsSnapshot(platform) : null;
  });

  ipcMain.handle(IPC.SOCKET_BOT_UPDATE_ENABLED, async (_event, raw: unknown, value: unknown) => {
    const platform = platformOf(raw);
    if (!platform) return refused();
    config[platform].enabled = Boolean(value);
    saveConfig({ [platform]: config[platform] });
    return sync(platform, config[platform].enabled ? 'enabled' : 'disabled');
  });

  // Only the fields the platform has, and only non-empty ones: a blank field keeps the saved secret.
  ipcMain.handle(IPC.SOCKET_BOT_UPDATE_SECRETS, async (_event, raw: unknown, secrets: unknown) => {
    const platform = platformOf(raw);
    if (!platform) return refused();
    const given = (secrets && typeof secrets === 'object') ? secrets as Record<string, unknown> : {};
    const section = config[platform] as unknown as Record<string, unknown>;
    for (const field of SOCKET_BOT_SECRET_FIELDS[platform]) {
      const value = typeof given[field] === 'string' ? (given[field] as string).trim() : '';
      if (value) section[field] = value;
    }
    saveConfig({ [platform]: config[platform] });
    return sync(platform, 'credentials updated');
  });

  ipcMain.handle(IPC.SOCKET_BOT_UPDATE_LLM_DIRECT, (_event, raw: unknown, value: unknown) => {
    const platform = platformOf(raw);
    if (!platform) return refused();
    config[platform].llmDirect = normalizeLlmDirect(value);
    saveConfig({ [platform]: config[platform] });
    return { ok: true as const, snapshot: buildSocketBotSettingsSnapshot(platform) };
  });

  ipcMain.handle(IPC.SOCKET_BOT_GENERATE_PAIRING_CODE, (_event, raw: unknown) => {
    const platform = platformOf(raw);
    if (!platform) return refused();
    issueSocketBotPairingCode(platform);
    return { ok: true as const, snapshot: buildSocketBotSettingsSnapshot(platform) };
  });

  ipcMain.handle(IPC.SOCKET_BOT_REVOKE_PAIRING_CODE, (_event, raw: unknown, code: unknown) => {
    const platform = platformOf(raw);
    if (!platform) return refused();
    revokeSocketBotPairingCode(platform, String(code ?? ''));
    return { ok: true as const, snapshot: buildSocketBotSettingsSnapshot(platform) };
  });

  ipcMain.handle(IPC.SOCKET_BOT_UNPAIR_USER, (_event, raw: unknown, userId: unknown) => {
    const platform = platformOf(raw);
    if (!platform) return refused();
    unpairSocketBotAccount(platform, String(userId ?? ''));
    return { ok: true as const, snapshot: buildSocketBotSettingsSnapshot(platform) };
  });

  ipcMain.handle(IPC.SOCKET_BOT_RECONNECT, async (_event, raw: unknown) => {
    const platform = platformOf(raw);
    if (!platform) return refused();
    try {
      await ctx.socketBots[platform].reconnect();
      return { ok: true as const, snapshot: buildSocketBotSettingsSnapshot(platform) };
    } catch (err: unknown) {
      return { ok: false as const, message: err instanceof Error ? err.message : String(err), snapshot: buildSocketBotSettingsSnapshot(platform) };
    }
  });
}
