import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import { config, saveConfig } from '../config';
import { normalizeProviderCommands } from '../configNormalizers';
import { sendLog } from '../helpers';
import type { IpcContext } from './context';

// Provider slash commands are shared by every bot platform. LINE resolves them
// per message, so only Telegram's '/' menu needs telling.
export function registerBotHandlers(ctx: IpcContext): void {
  ipcMain.handle(IPC.GET_BOT_PROVIDER_COMMANDS, () => config.providerCommands);

  ipcMain.handle(IPC.UPDATE_BOT_PROVIDER_COMMANDS, async (_event, value: unknown) => {
    config.providerCommands = normalizeProviderCommands(value);
    saveConfig({ providerCommands: config.providerCommands });
    try {
      await ctx.telegramRuntime.refreshBotCommands();
      return true;
    } catch (err: unknown) {
      sendLog(`⚠️ Failed to refresh the Telegram command menu: ${(err as Error).message}`);
      return false;
    }
  });
}
