import { sendLog, sendSecurityNotification } from '../helpers';
import { getLangCache, t } from '../i18n';
import { takeStoreRecoveryNotices } from '../configStore';
import type { StoreRecoveryNotice } from '../configStore';

/**
 * Tells the user that a settings or secret file could not be read and was moved aside, on the
 * security channel so the "notify me" toggle cannot hide it. Called once the window and language
 * pack exist, since the notices are collected during module import and startup.
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
