import { ipcMain } from 'electron';
import { IPC, SITE_ACCOUNTS } from '../../shared/types';
import type { AuthProvider, Provider, SiteAccount } from '../../shared/types';
import { getAllAccountStatuses } from '../providers/authStatus';
import { openAccountLoginWindow, logoutAccount, clearProviderData } from '../accounts';
import { getAllSiteAccountStatuses, logoutSiteAccount, openSiteAccountLogin } from '../siteAccounts';

function isSiteAccount(value: unknown): value is SiteAccount {
  return (SITE_ACCOUNTS as readonly unknown[]).includes(value);
}

export function registerAccountHandlers(): void {
  ipcMain.handle(IPC.GET_ACCOUNT_STATUSES, () => getAllAccountStatuses());
  ipcMain.handle(IPC.OPEN_ACCOUNT_LOGIN, (_event, provider: AuthProvider) => openAccountLoginWindow(provider));
  ipcMain.handle(IPC.ACCOUNT_LOGOUT, (_event, provider: AuthProvider) => logoutAccount(provider));
  ipcMain.handle(IPC.PROVIDER_CLEAR_DATA, (_event, provider: Provider) => clearProviderData(provider));
  ipcMain.handle(IPC.GET_SITE_ACCOUNT_STATUSES, () => getAllSiteAccountStatuses());
  ipcMain.handle(IPC.OPEN_SITE_ACCOUNT_LOGIN, (_event, site: unknown) => (isSiteAccount(site) ? openSiteAccountLogin(site) : false));
  ipcMain.handle(IPC.SITE_ACCOUNT_LOGOUT, (_event, site: unknown) => (isSiteAccount(site) ? logoutSiteAccount(site) : false));
}
