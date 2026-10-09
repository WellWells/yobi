import type { BackupCategoryId, BackupCategoryInfo } from '../../../../../shared/types';

/**
 * Categories that show no count. Settings and personal memory are each a single file, so a
 * count would always read "1".
 */
export const UNCOUNTED_BACKUP_CATEGORIES: ReadonlySet<BackupCategoryId> = new Set<BackupCategoryId>([
  'config',
  'userMemory',
]);

export function backupCountLabel(
  t: (key: string) => string,
  id: BackupCategoryId,
  info?: BackupCategoryInfo,
): string {
  if (!info?.available) return t('settings.backup.unavailable');
  if (UNCOUNTED_BACKUP_CATEGORIES.has(id)) return '';
  return t(`settings.backup.count.${id}`).replace('{{count}}', String(info.count));
}
