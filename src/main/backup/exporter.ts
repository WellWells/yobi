import { app } from 'electron';
import { existsSync } from 'node:fs';
import AdmZip from 'adm-zip';
import { BACKUP_CATEGORY_IDS } from '../../shared/types';
import type { BackupCategoryId, BackupCategoryInfo } from '../../shared/types';
import {
  BACKUP_TYPE,
  BACKUP_VERSION,
  CATEGORY_DEFS,
  MANIFEST_ENTRY,
  orderCategories,
} from './manifest';
import type { BackupManifest } from './manifest';
import { countCategoryItems, walkDirFiles } from './fsUtils';

// Availability + item counts for every category — drives the export modal
// (empty categories render disabled so they can never be selected).
export async function getCategoryInfos(): Promise<BackupCategoryInfo[]> {
  return Promise.all(
    BACKUP_CATEGORY_IDS.map(async (id) => {
      const count = await countCategoryItems(CATEGORY_DEFS[id]);
      return { id, count, available: count > 0 };
    }),
  );
}

// Build a backup zip from the selected categories and write it to `targetPath`.
// Categories with no items are skipped so a restore never wipes-to-empty. Returns
// the categories actually written.
export async function buildBackupZip(
  requested: BackupCategoryId[],
  targetPath: string,
): Promise<BackupCategoryId[]> {
  const zip = new AdmZip();
  const included: BackupCategoryId[] = [];
  const counts: Partial<Record<BackupCategoryId, number>> = {};

  for (const id of orderCategories(requested)) {
    const def = CATEGORY_DEFS[id];
    const source = await def.resolveSource();

    if (def.kind === 'file') {
      if (!existsSync(source)) continue;
      try {
        zip.addLocalFile(source, '');
      } catch {
        continue;
      }
      included.push(id);
      counts[id] = 1;
      continue;
    }

    const files = walkDirFiles(source, def.fileFilter);
    if (files.length === 0) continue;
    let added = 0;
    for (const file of files) {
      const zipRel = `${def.zipPrefix}/${file.rel}`;
      const slash = zipRel.lastIndexOf('/');
      try {
        zip.addLocalFile(file.abs, slash >= 0 ? zipRel.slice(0, slash) : '');
        added += 1;
      } catch {
        // File vanished or got locked between the walk and the add (e.g. a
        // running flow rotating a checkpoint) — skip it, keep the rest.
      }
    }
    if (added === 0) continue;
    included.push(id);
    counts[id] = added;
  }

  const manifest: BackupManifest = {
    type: BACKUP_TYPE,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    categories: included,
    counts,
  };
  zip.addFile(MANIFEST_ENTRY, Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'));

  zip.writeZip(targetPath);
  return included;
}
