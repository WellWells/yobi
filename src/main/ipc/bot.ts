import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import { config, saveConfig } from '../config';
import {
  normalizeBotByokCommands,
  normalizeBuiltinCommands,
  normalizeProviderCommands,
} from '../configNormalizers';
import { sendLog } from '../helpers';
import { listBotByokCommands } from '../bootstrap/botCommands';
import type { IpcContext } from './context';

export function registerBotHandlers(ctx: IpcContext): void {
  ipcMain.handle(IPC.GET_BOT_PROVIDER_COMMANDS, () => config.providerCommands);

  ipcMain.handle(IPC.UPDATE_BOT_PROVIDER_COMMANDS, async (_event, value: unknown) => {
    config.providerCommands = normalizeProviderCommands(value);
    saveConfig({ providerCommands: config.providerCommands });
    return refreshCommandMenu(ctx);
  });

  ipcMain.handle(IPC.GET_BOT_BUILTIN_COMMANDS, () => config.builtinCommands);

  ipcMain.handle(IPC.UPDATE_BOT_BUILTIN_COMMANDS, async (_event, value: unknown) => {
    config.builtinCommands = normalizeBuiltinCommands(value);
    saveConfig({ builtinCommands: config.builtinCommands });
    return refreshCommandMenu(ctx);
  });

  ipcMain.handle(IPC.GET_BOT_BYOK_COMMANDS, () =>
    listBotByokCommands(() => ctx.flowManager ?? null));

  ipcMain.handle(IPC.UPDATE_BOT_BYOK_COMMANDS, async (_event, id: unknown, enabled: unknown) => {
    const key = typeof id === 'string' ? id.trim() : '';
    if (!key) return false;
    const next = { ...config.botByokCommands };
    if (enabled === false) next[key] = false;
    else delete next[key];
    config.botByokCommands = normalizeBotByokCommands(next);
    saveConfig({ botByokCommands: config.botByokCommands });
    return refreshCommandMenu(ctx);
  });
}

async function refreshCommandMenu(ctx: IpcContext): Promise<boolean> {
  try {
    await ctx.telegramRuntime.refreshBotCommands();
    return true;
  } catch (err: unknown) {
    sendLog(`⚠️ Failed to refresh the Telegram command menu: ${(err as Error).message}`);
    return false;
  }
}
