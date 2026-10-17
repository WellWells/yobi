import type { BackupCategoryId, BackupCategoryInfo } from '../../../../../shared/types';

/**
 * Categories that show no count. Settings and personal memory are each a single file, so a
 * count would always read "1"; version history is files per version plus an index each, a number
 * that means nothing to the reader.
 */
export const UNCOUNTED_BACKUP_CATEGORIES: ReadonlySet<BackupCategoryId> = new Set<BackupCategoryId>([
  'config',
  'userMemory',
  'history',
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

/**
 * What restoring a category does to the data on this device. A single-file category has its own
 * sentence, since the counted one would read "Replaces current 1 with 1".
 */
export function backupImpactLabel(
  t: (key: string) => string,
  id: BackupCategoryId,
  incoming: number,
  current: number,
): string {
  if (UNCOUNTED_BACKUP_CATEGORIES.has(id)) return t(`settings.backup.impact.${id}`);
  return t(id === 'outputs' ? 'settings.backup.impact.outputs' : 'settings.backup.impact.replace')
    .replace('{{incoming}}', String(incoming))
    .replace('{{current}}', String(current));
}
