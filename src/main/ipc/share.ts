import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import type { ShareLinkRequest, ShareLinkResult, ShareSettings } from '../../shared/types';
import { config, saveConfig, normalizeShareSettings } from '../config';
import { sendLog } from '../helpers';
import { ShareError, createPaste, revokePaste } from '../share/privatebin';
import { effectiveExpire, probeInstanceExpires } from '../share/instanceExpires';

/**
 * Reads the expiry options a share server offers and caches them under that URL. A reply for a
 * URL the user has already replaced is dropped, so a slow probe never files its options under
 * the newer server.
 */
export async function refreshInstanceExpires(url: string): Promise<void> {
  const values = await probeInstanceExpires(url);
  if (config.share.instanceUrl !== url) return;
  config.share = normalizeShareSettings({
    ...config.share,
    instanceExpires: values ? { url, values } : null,
  });
  saveConfig({ share: config.share });
  sendLog(
    values
      ? `🔗 Share instance offers: ${values.join(', ')}`
      : `⚠️ Could not read the expiry options of ${url} — using the PrivateBin defaults`,
  );
}

export function registerShareHandlers(): void {
  ipcMain.handle(IPC.GET_SHARE_SETTINGS, (): ShareSettings => config.share);

  ipcMain.handle(IPC.UPDATE_SHARE_SETTINGS, (_event, patch: Partial<ShareSettings>): ShareSettings => {
    const previousUrl = config.share.instanceUrl;
    config.share = normalizeShareSettings({ ...config.share, ...patch });
    saveConfig({ share: config.share });
    // The probe can take its full timeout, so the URL is saved and answered first; holding the
    // reply would overwrite a field the user edited during the wait.
    if (config.share.instanceUrl !== previousUrl) void refreshInstanceExpires(config.share.instanceUrl);
    return config.share;
  });

  ipcMain.handle(IPC.SHARE_CREATE_LINK, async (_event, request: ShareLinkRequest): Promise<ShareLinkResult> => {
    if (!config.share.consentedAt) return { ok: false, error: 'noConsent' };

    const instanceUrl = config.share.instanceUrl;
    try {
      const expire = effectiveExpire(config.share, request?.expire ?? config.share.expire);
      const { url, deleteUrl } = await createPaste(instanceUrl, request?.markdown ?? '', {
        expire,
        burnAfterReading: request?.burnAfterReading === true,
      });
      sendLog(`🔗 Share link created on ${instanceUrl} (expires: ${expire})`);
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
