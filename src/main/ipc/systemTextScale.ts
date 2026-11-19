import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import { readSystemTextScale } from '../systemTextScale';

export function registerSystemTextScaleHandlers(): void {
  ipcMain.handle(IPC.GET_SYSTEM_TEXT_SCALE, () => readSystemTextScale());
}
