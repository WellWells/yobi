import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import type { BotAudienceSnapshot, BotPlatform } from '../../shared/types';
import { getBotAudience } from '../botPermissions/audience';
import type { BotSetBlockedResult, BotSetGroupPermissionsResult, BotSetPermissionsResult } from '../../shared/botPermissions';
import { setBotGroupPermissions, setBotPermissions, setBotUserBlocked } from '../botPermissions';
import { sendLog, sendToRenderer } from '../helpers';
import { getLineRuntimeSnapshot } from '../lineBridge';
import { getTelegramRuntimeSnapshot } from '../telegramBridge';
import type { IpcContext } from './context';

/**
 * After any grant change: the settings page refetches its platform snapshot on the runtime
 * broadcast it already listens to, and the Telegram "/" menus are rebuilt, since which commands
 * an account sees depends on what it may run.
 */
export function announceBotPermissionsChanged(ctx: Pick<IpcContext, 'telegramRuntime'>, platform: BotPlatform): void {
  if (platform === 'line') {
    sendToRenderer(IPC.LINE_RUNTIME, getLineRuntimeSnapshot());
    return;
  }
  sendToRenderer(IPC.TELEGRAM_RUNTIME, getTelegramRuntimeSnapshot());
  void ctx.telegramRuntime.refreshBotCommands().catch((err: unknown) => {
    sendLog(`⚠️ Telegram command menu refresh failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}

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
    platform === 'telegram' || platform === 'line' ? getBotAudience(platform) : { groups: [], users: [] }
  ));

  ipcMain.handle(IPC.BOT_SET_BLOCKED, (_event, request: unknown): BotSetBlockedResult => {
    const result = setBotUserBlocked(request);
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
