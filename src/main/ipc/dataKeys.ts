import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import type { DataKeyStatus } from '../../shared/types';
import { getDataKey, setDataKey } from '../dataKeyStore';
import { maskToken, sendLog } from '../helpers';

export function registerDataKeyHandlers(): void {
  ipcMain.handle(IPC.GET_DATA_KEY_STATUS, (_event, name: string): DataKeyStatus => {
    const key = getDataKey(String(name ?? ''));
    return { hasKey: Boolean(key.trim()), preview: maskToken(key) };
  });

  ipcMain.handle(IPC.UPDATE_DATA_KEY, (_event, name: string, value: string) => {
    const id = String(name ?? '').trim();
    if (!id) return { ok: false as const };
    setDataKey(id, String(value ?? ''));
    sendLog(`Data source key "${id}" ${String(value ?? '').trim() ? 'updated' : 'cleared'}`);
    return { ok: true as const };
  });
}
