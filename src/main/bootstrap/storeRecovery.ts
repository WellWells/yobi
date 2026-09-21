import { sendLog, sendSecurityNotification } from '../helpers';
import { getLangCache, t } from '../i18n';
import { takeStoreRecoveryNotices } from '../configStore';
import type { StoreRecoveryNotice } from '../configStore';

/**
 * Tells the user that a settings or secret file could not be read and was moved aside.
 *
 * Recovering quietly would be its own bug: from the user's side their settings reset
 * themselves, or a key they saved stopped working, with nothing to explain it and no idea
 * that a copy of the old file is sitting next to it. This goes out on the security channel so
 * the "notify me" toggle cannot hide it.
 *
 * The notices are collected before the app can talk to anyone — the config store is built at
 * module import time and the secret stores during startup — so this is called once the window
 * and the language pack exist.
 */
export function reportStoreRecoveries(notices = takeStoreRecoveryNotices()): void {
  if (notices.length === 0) return;
  const strings = getLangCache();
  for (const notice of notices) {
    sendLog(`⚠️ ${notice.file} could not be read (${notice.detail})${
      notice.backupFile ? ` — kept as ${notice.backupFile}` : ''
    }`);
    sendSecurityNotification(
      t(strings, 'notify.storeRecovered.title'),
      notice.backupFile
        ? t(strings, 'notify.storeRecovered.body', { file: notice.file, backup: notice.backupFile })
        : t(strings, 'notify.storeRecovered.bodyNoBackup', { file: notice.file }),
    );
  }
}

export type { StoreRecoveryNotice };
