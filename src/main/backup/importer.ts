import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import AdmZip from 'adm-zip';
import { sendLog } from '../helpers';
import { importConfigFromJson } from '../config';
import type { Config } from '../config';
import { getFlowDataDir } from '../flow';
import type { BackupCategoryId, BackupInspectItem, BackupInspectResult } from '../../shared/types';
import {
  CATEGORY_DEFS,
  MANIFEST_ENTRY,
  isValidManifest,
  manifestCategories,
  orderCategories,
} from './manifest';
import type { CategoryDef } from './manifest';
import { countCategoryItems, safeResolveWithin, walkDirFiles } from './fsUtils';

export interface ApplyBackupDeps {
  reloadFlows: () => Promise<void>;
}

export interface ApplyBackupResult {
  restored: BackupCategoryId[];
  importedConfig: Config | null;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function countZipCategory(zip: AdmZip, def: CategoryDef): number {
  if (def.kind === 'file') return zip.getEntry(def.zipPrefix) ? 1 : 0;
  const prefix = `${def.zipPrefix}/`;
  let count = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const name = entry.entryName.replace(/\\/g, '/');
    if (!name.startsWith(prefix)) continue;
    if (def.fileFilter && !def.fileFilter(path.basename(name))) continue;
    count += 1;
  }
  return count;
}

// Read + validate a backup zip and compute the per-category overwrite impact
// (incoming vs. current counts) for the import warning page. Never mutates disk.
export async function inspectBackup(zipPath: string): Promise<BackupInspectResult> {
  let zip: AdmZip;
  try {
    zip = new AdmZip(zipPath);
  } catch {
    return { valid: false, error: 'not-zip', items: [] };
  }

  const manifestEntry = zip.getEntry(MANIFEST_ENTRY);
  if (!manifestEntry) return { valid: false, error: 'no-manifest', items: [] };

  let manifest: unknown;
  try {
    manifest = JSON.parse(zip.readAsText(manifestEntry));
  } catch {
    return { valid: false, error: 'bad-manifest', items: [] };
  }
  if (!isValidManifest(manifest)) return { valid: false, error: 'bad-manifest', items: [] };

  const items: BackupInspectItem[] = [];
  for (const id of manifestCategories(manifest)) {
    const def = CATEGORY_DEFS[id];
    const incomingCount = countZipCategory(zip, def);
    if (incomingCount === 0) continue;
    const currentCount = await countCategoryItems(def);
    items.push({ id, incomingCount, currentCount });
  }

  return {
    valid: true,
    appVersion: manifest.appVersion,
    createdAt: manifest.createdAt,
    items,
  };
}

async function restoreConfig(zip: AdmZip): Promise<Config | null> {
  const entry = zip.getEntry('config.json');
  if (!entry) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(zip.readAsText(entry));
  } catch {
    return null;
  }
  // Reuse the config import path: normalize, decrypt safeStorage fields, persist
  // to the electron-store + in-memory config, keep-if-blank for cross-machine.
  return importConfigFromJson(parsed);
}

async function restoreFlows(zip: AdmZip, deps: ApplyBackupDeps): Promise<boolean> {
  const entry = zip.getEntry('flows.json');
  if (!entry) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(zip.readAsText(entry));
  } catch {
    return false;
  }
  // flows.json is a bare array; never write a malformed non-array (would wipe flows).
  if (!Array.isArray(parsed)) return false;
  const flowsPath = path.join(getFlowDataDir(), 'flows.json');
  await fs.mkdir(path.dirname(flowsPath), { recursive: true });
  await fs.writeFile(flowsPath, JSON.stringify(parsed, null, 2), 'utf-8');
  await deps.reloadFlows();
  return true;
}

async function restoreDir(zip: AdmZip, def: CategoryDef): Promise<boolean> {
  const targetDir = await def.resolveSource();
  const prefix = `${def.zipPrefix}/`;
  const entries = zip.getEntries().filter((entry) => {
    if (entry.isDirectory) return false;
    const name = entry.entryName.replace(/\\/g, '/');
    if (!name.startsWith(prefix)) return false;
    if (def.fileFilter && !def.fileFilter(path.basename(name))) return false;
    return true;
  });
  if (entries.length === 0) return false;

  if (def.replaceMode === 'whole-dir') {
    await fs.rm(targetDir, { recursive: true, force: true });
  } else {
    for (const file of walkDirFiles(targetDir, def.fileFilter)) {
      await fs.rm(file.abs, { force: true }).catch(() => {});
    }
  }
  await fs.mkdir(targetDir, { recursive: true });

  for (const entry of entries) {
    const name = entry.entryName.replace(/\\/g, '/');
    const rel = name.slice(prefix.length);
    const dest = safeResolveWithin(targetDir, rel);
    if (!dest) continue; // zip-slip guard: skip anything escaping the target dir
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, entry.getData());
  }
  return true;
}

// Apply the selected categories in place. Best-effort: a failing category is
// logged and skipped, the rest still apply. `importedConfig` is surfaced so the
// caller can run the config live-reload side effects (worker, hotkey, telegram…).
export async function applyBackup(
  zipPath: string,
  requested: BackupCategoryId[],
  deps: ApplyBackupDeps,
): Promise<ApplyBackupResult> {
  const zip = new AdmZip(zipPath);
  const restored: BackupCategoryId[] = [];
  let importedConfig: Config | null = null;

  for (const id of orderCategories(requested)) {
    try {
      if (id === 'config') {
        const cfg = await restoreConfig(zip);
        if (cfg) {
          importedConfig = cfg;
          restored.push('config');
        }
      } else if (id === 'flows') {
        if (await restoreFlows(zip, deps)) restored.push('flows');
      } else if (await restoreDir(zip, CATEGORY_DEFS[id])) {
        restored.push(id);
      }
    } catch (err: unknown) {
      sendLog(`⚠️ Backup restore failed for "${id}": ${errMsg(err)}`);
    }
  }

  return { restored, importedConfig };
}
