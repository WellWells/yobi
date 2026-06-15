import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import type { AuthProvider, Provider } from '../../shared/types';
import { getAllAccountStatuses } from '../providers/authStatus';
import { openAccountLoginWindow, logoutAccount, clearProviderData } from '../accounts';

export function registerAccountHandlers(): void {
  ipcMain.handle(IPC.GET_ACCOUNT_STATUSES, () => getAllAccountStatuses());
  ipcMain.handle(IPC.OPEN_ACCOUNT_LOGIN, (_event, provider: AuthProvider) => openAccountLoginWindow(provider));
  ipcMain.handle(IPC.ACCOUNT_LOGOUT, (_event, provider: AuthProvider) => logoutAccount(provider));
  ipcMain.handle(IPC.PROVIDER_CLEAR_DATA, (_event, provider: Provider) => clearProviderData(provider));
}
