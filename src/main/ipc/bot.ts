import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import { config } from '../config';
import { listBotByokCommands } from '../bootstrap/botCommands';
import { applyBotByokCommands, applyBuiltinCommands, applyProviderCommands, setSettingsContext } from './settingsApply';
import type { IpcContext } from './context';

export function registerBotHandlers(ctx: IpcContext): void {
  setSettingsContext(ctx);
  ipcMain.handle(IPC.GET_BOT_PROVIDER_COMMANDS, () => config.providerCommands);

  ipcMain.handle(IPC.UPDATE_BOT_PROVIDER_COMMANDS, (_event, value: unknown) => applyProviderCommands(value));

  ipcMain.handle(IPC.GET_BOT_BUILTIN_COMMANDS, () => config.builtinCommands);

  ipcMain.handle(IPC.UPDATE_BOT_BUILTIN_COMMANDS, (_event, value: unknown) => applyBuiltinCommands(value));

  ipcMain.handle(IPC.GET_BOT_BYOK_COMMANDS, () =>
    listBotByokCommands(() => ctx.flowManager ?? null));

  ipcMain.handle(IPC.UPDATE_BOT_BYOK_COMMANDS, async (_event, id: unknown, enabled: unknown) => {
    const key = typeof id === 'string' ? id.trim() : '';
    if (!key) return false;
    const next = { ...config.botByokCommands };
    if (enabled === false) next[key] = false;
    else delete next[key];
    return applyBotByokCommands(next);
  });
}
