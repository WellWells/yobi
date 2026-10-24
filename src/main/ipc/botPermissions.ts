import { ipcMain } from 'electron';
import { IPC, isBotPlatform } from '../../shared/types';
import type { BotAudienceSnapshot, BotPlatform } from '../../shared/types';
import { getBotAudience } from '../botPermissions/audience';
import type {
  BotApprovePairingResult,
  BotSetBlockedResult,
  BotSetDefaultGrantsResult,
  BotSetGroupPermissionsResult,
  BotSetPermissionsResult,
} from '../../shared/botPermissions';
import {
  approveBotPairingRequest,
  setBotDefaultGrants,
  setBotGroupPermissions,
  setBotPermissions,
  setBotUserBlockedAnsweringRequest,
} from '../botPermissions';
import { sendLog, sendToRenderer } from '../helpers';
import { getLineRuntimeSnapshot } from '../lineBridge';
import { announceSocketBotRuntime } from '../socketBotBridge';
import { getTelegramRuntimeSnapshot } from '../telegramBridge';
import type { IpcContext } from './context';

/**
 * After any grant change: the settings page refetches its platform snapshot on the runtime
 * broadcast it already listens to, and the Telegram "/" menus are rebuilt, since which commands
 * an account sees depends on what it may run.
 */
export function announceBotPermissionsChanged(ctx: Pick<IpcContext, 'telegramRuntime'>, platform: BotPlatform): void {
  RUNTIME_BROADCASTS[platform]();
  if (platform !== 'telegram') return;
  void ctx.telegramRuntime.refreshBotCommands().catch((err: unknown) => {
    sendLog(`⚠️ Telegram command menu refresh failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}

/** Each platform's runtime snapshot, sent where its settings section listens. */
const RUNTIME_BROADCASTS: Readonly<Record<BotPlatform, () => void>> = {
  telegram: () => sendToRenderer(IPC.TELEGRAM_RUNTIME, getTelegramRuntimeSnapshot()),
  line: () => sendToRenderer(IPC.LINE_RUNTIME, getLineRuntimeSnapshot()),
  discord: () => announceSocketBotRuntime('discord'),
  slack: () => announceSocketBotRuntime('slack'),
};

export function registerBotPermissionsHandlers(ctx: IpcContext): void {
  ipcMain.handle(IPC.BOT_SET_PERMISSIONS, (_event, request: unknown): BotSetPermissionsResult => {
    const result = setBotPermissions(request);
    if (!result.ok) {
      sendLog(`[bot] permissions change refused: ${result.reason}`);
      return result;
    }
    const platform = (request as { platform: BotPlatform }).platform;
    sendLog(`[bot] ${platform} permissions updated (${result.grants.length} grant(s))`);
    announceBotPermissionsChanged(ctx, platform);
    return result;
  });

  ipcMain.handle(IPC.BOT_SET_DEFAULT_GRANTS, (_event, request: unknown): BotSetDefaultGrantsResult => {
    const result = setBotDefaultGrants(request);
    if (!result.ok) {
      sendLog(`[bot] default grants change refused: ${result.reason}`);
      return result;
    }
    const platform = (request as { platform: BotPlatform }).platform;
    sendLog(`[bot] ${platform} default grants for new pairings updated (${result.grants.length} grant(s))`);
    announceBotPermissionsChanged(ctx, platform);
    return result;
  });

  ipcMain.handle(IPC.BOT_SET_GROUP_PERMISSIONS, (_event, request: unknown): BotSetGroupPermissionsResult => {
    const result = setBotGroupPermissions(request);
    if (!result.ok) {
      sendLog(`[bot] group permissions change refused: ${result.reason}`);
      return result;
    }
    const platform = (request as { platform: BotPlatform }).platform;
    sendLog(`[bot] ${platform} group ${result.pending ? 'back to pending approval' : `allowed (${result.grants.length} grant(s))`}`);
    announceBotPermissionsChanged(ctx, platform);
    return result;
  });

  ipcMain.handle(IPC.BOT_GET_AUDIENCE, async (_event, platform: unknown): Promise<BotAudienceSnapshot> => (
    typeof platform === 'string' && isBotPlatform(platform) ? getBotAudience(platform) : { groups: [], users: [] }
  ));

  ipcMain.handle(IPC.BOT_APPROVE_PAIRING_REQUEST, async (_event, request: unknown): Promise<BotApprovePairingResult> => {
    const result = await approveBotPairingRequest(request);
    if (!result.ok) {
      sendLog(`[bot] pairing request approval refused: ${result.reason}`);
      return result;
    }
    const platform = (request as { platform: BotPlatform }).platform;
    sendLog(`[bot] ${platform} pairing request approved in settings${result.newlyPaired ? '' : ' (already paired)'}`);
    announceBotPermissionsChanged(ctx, platform);
    return result;
  });

  ipcMain.handle(IPC.BOT_SET_BLOCKED, async (_event, request: unknown): Promise<BotSetBlockedResult> => {
    const result = await setBotUserBlockedAnsweringRequest(request);
    if (!result.ok) {
      sendLog(`[bot] block change refused: ${result.reason}`);
      return result;
    }
    const platform = (request as { platform: BotPlatform }).platform;
    sendLog(`[bot] ${platform} user ${result.blocked ? 'blocked' : 'unblocked'}`);
    announceBotPermissionsChanged(ctx, platform);
    return result;
  });
}
