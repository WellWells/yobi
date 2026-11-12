import { IPC, SECRET_SCOPE_META } from '../../shared/types';
import { sendLog, sendSecurityNotification, sendToRenderer, setSecretSettingsReveal } from '../helpers';
import { getLangCache, t } from '../i18n';
import { reEncryptSensitiveConfig } from '../config';
import { hasPendingSecretWrites, openSecrets, secretWritesSettled } from '../configEncryption';
import { probeDataKeys, reEncryptDataKeys, storedDataKeys } from '../dataKeyStore';
import { probeAuthRecords, reEncryptAuthRecords, storedAuthRecords } from '../mcp/mcpTokenStore';
import { probeCalendars, reEncryptCalendars } from '../calendar/calendarStore';
import { calendarFile } from '../calendar/calendarFile';
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

/**
 * Decrypts every stored secret up front, which the stores' synchronous reads depend on, and so a
 * broken one is known at boot, not mid-task. The config's own secrets come with `initSensitiveConfig`.
 */
export async function probeStoredSecrets(): Promise<void> {
  await openSecrets([storedAuthRecords(), storedDataKeys(), calendarFile().store]);
  probeAuthRecords();
  probeDataKeys();
  probeCalendars();
}

const QUIT_WAIT_FOR_SECRETS_MS = 3_000;
let quitHeldForSecrets = false;

/**
 * Holds the first quit until the secrets still being encrypted are written (a token saved a
 * moment before quitting), at most a few seconds; true when it did. Quitting again goes through.
 */
export function holdQuitForSecretWrites(event: { preventDefault: () => void }, quit: () => void): boolean {
  if (quitHeldForSecrets || !hasPendingSecretWrites()) return false;
  quitHeldForSecrets = true;
  event.preventDefault();
  const limit = new Promise<void>((resolve) => setTimeout(resolve, QUIT_WAIT_FOR_SECRETS_MS));
  void Promise.race([secretWritesSettled(), limit]).finally(quit);
  return true;
}

/**
 * Runs after the windows and language packs are up, so the warning can actually be shown and
 * read. Also performs the one re-encryption sweep Electron asks for when the OS hands us a
 * stronger key provider — skipping it would leave every secret tied to a key on its way out.
 */
export async function reportSecretHealth(): Promise<void> {
  const { state, shouldReEncrypt } = await checkSecretKey();

  if (shouldReEncrypt) {
    await Promise.all([reEncryptSensitiveConfig(), reEncryptAuthRecords(), reEncryptDataKeys(), reEncryptCalendars()]);
    await refreshCanary();
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
