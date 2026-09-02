import { IPC, SECRET_SCOPE_META } from '../../shared/types';
import { sendLog, sendSecurityNotification, sendToRenderer, setSecretSettingsReveal } from '../helpers';
import { getLangCache, t } from '../i18n';
import { reEncryptSensitiveConfig } from '../config';
import { probeDataKeys, reEncryptDataKeys } from '../dataKeyStore';
import { probeAuthRecords, reEncryptAuthRecords } from '../mcp/mcpTokenStore';
import { checkSecretKey, getSecretHealth, refreshCanary, setSecretHealthListener } from '../secretHealth';
import { getMainWin } from '../windows';

/**
 * Wired before any secret is read so the very first failure is already routed to the renderer.
 * Publishing to a window that does not exist yet is a no-op; the renderer also pulls the
 * current health on mount, so nothing is lost by being early.
 */
export function initSecretHealthBridge(): void {
  setSecretHealthListener((health) => sendToRenderer(IPC.SECRET_HEALTH_CHANGED, health));
  setSecretSettingsReveal(() => {
    const win = getMainWin();
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    sendToRenderer(IPC.NAVIGATE_SETTINGS);
  });
}

/** Decrypts every stored secret up front so a broken one is known at boot, not mid-task. */
export function probeStoredSecrets(): void {
  probeAuthRecords();
  probeDataKeys();
}

/**
 * Runs after the windows and language packs are up, so the warning can actually be shown and
 * read. Also performs the one re-encryption sweep Electron asks for when the OS hands us a
 * stronger key provider — skipping it would leave every secret tied to a key on its way out.
 */
export async function reportSecretHealth(): Promise<void> {
  const { state, shouldReEncrypt } = await checkSecretKey();

  if (shouldReEncrypt) {
    reEncryptSensitiveConfig();
    reEncryptAuthRecords();
    reEncryptDataKeys();
    refreshCanary();
    sendLog('🔐 Stored secrets re-encrypted under the OS key provider that replaced the old one');
  }

  const { failures } = getSecretHealth();
  if (failures.length === 0) return;

  const strings = getLangCache();
  const scopes = [...new Set(failures.map((failure) => t(strings, SECRET_SCOPE_META[failure.scope].labelKey)))].join('、');
  sendLog(`⚠️ ${failures.length} stored secret(s) could not be decrypted (${scopes}) — they must be re-entered`);
  sendSecurityNotification(
    t(strings, 'secret.notify.title'),
    t(strings, state === 'rotated' ? 'secret.notify.bodyRotated' : 'secret.notify.body', { scopes }),
    { id: 'open-secret-settings', label: t(strings, 'secret.notify.action') },
  );
}
