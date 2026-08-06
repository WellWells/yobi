import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import type { ShareLinkRequest, ShareLinkResult, ShareSettings } from '../../shared/types';
import { config, saveConfig, normalizeShareSettings } from '../config';
import { sendLog } from '../helpers';
import { ShareError, createPaste, revokePaste } from '../share/privatebin';

export function registerShareHandlers(): void {
  ipcMain.handle(IPC.GET_SHARE_SETTINGS, (): ShareSettings => config.share);

  ipcMain.handle(IPC.UPDATE_SHARE_SETTINGS, (_event, patch: Partial<ShareSettings>) => {
    config.share = normalizeShareSettings({ ...config.share, ...patch });
    saveConfig({ share: config.share });
    return config.share;
  });

  ipcMain.handle(IPC.SHARE_CREATE_LINK, async (_event, request: ShareLinkRequest): Promise<ShareLinkResult> => {
    if (!config.share.consentedAt) return { ok: false, error: 'noConsent' };

    const instanceUrl = config.share.instanceUrl;
    try {
      const { url, deleteUrl } = await createPaste(instanceUrl, request?.markdown ?? '', {
        expire: request?.expire ?? config.share.expire,
        burnAfterReading: request?.burnAfterReading === true,
      });
      sendLog(`🔗 Share link created on ${instanceUrl} (expires: ${request?.expire ?? config.share.expire})`);
      return { ok: true, url, deleteUrl };
    } catch (err: unknown) {
      if (err instanceof ShareError) {
        sendLog(`⚠️ Share link failed (${err.code}): ${err.detail || 'no detail'}`);
        return { ok: false, error: err.code, detail: err.detail };
      }
      const message = err instanceof Error ? err.message : String(err);
      sendLog(`⚠️ Share link failed: ${message}`);
      return { ok: false, error: 'unknown', detail: message };
    }
  });

  ipcMain.handle(IPC.SHARE_REVOKE_LINK, async (_event, deleteUrl: string): Promise<ShareLinkResult> => {
    try {
      await revokePaste(config.share.instanceUrl, deleteUrl ?? '');
      sendLog('🔗 Share link revoked');
      return { ok: true };
    } catch (err: unknown) {
      if (err instanceof ShareError) {
        sendLog(`⚠️ Share revoke failed (${err.code}): ${err.detail || 'no detail'}`);
        return { ok: false, error: err.code, detail: err.detail };
      }
      const message = err instanceof Error ? err.message : String(err);
      sendLog(`⚠️ Share revoke failed: ${message}`);
      return { ok: false, error: 'unknown', detail: message };
    }
  });
}
