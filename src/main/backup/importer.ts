import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import AdmZip from 'adm-zip';
import { sendLog } from '../helpers';
import { importConfigFromJson } from '../config';
import type { Config } from '../config';
import { saveFlowsToDisk } from '../flow/flowPersistence';
import type { BackupCategoryId, BackupInspectItem, BackupInspectResult, FlowDefinition } from '../../shared/types';
import { errorText } from '../../shared/errorText';
import {
  CATEGORY_DEFS,
  MANIFEST_ENTRY,
  isValidManifest,
  manifestCategories,
  orderCategories,
} from './manifest';
import type { BackupManifest, CategoryDef } from './manifest';
import { countCategoryItems } from './fsUtils';
import { readIncomingFiles, replaceDirFiles } from './restoreDir';
import { resetFlowVersionCache } from '../flow/flowVersions';
import { notionSyncRoot } from '../notion/notionSyncStore';
import { FOLDER_STATE_FILE } from '../conversationFolderPaths';
import { getFlowDataDir } from '../flow';

interface ApplyBackupDeps {
  reloadFlows: () => Promise<void>;
}

interface ApplyBackupResult {
  restored: BackupCategoryId[];
  importedConfig: Config | null;
}

function countZipCategory(zip: AdmZip, def: CategoryDef): number {
  if (def.kind === 'file') return zip.getEntry(def.zipPrefix) ? 1 : 0;
  const prefix = `${def.zipPrefix}/`;
  let count = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const name = entry.entryName.replace(/\\/g, '/');
    if (!name.startsWith(prefix)) continue;
    if (def.fileFilter && !def.fileFilter(name.slice(prefix.length))) continue;
    count += 1;
  }
  return count;
}

function readManifest(zip: AdmZip): BackupManifest | 'no-manifest' | 'bad-manifest' {
  const manifestEntry = zip.getEntry(MANIFEST_ENTRY);
  if (!manifestEntry) return 'no-manifest';
  let manifest: unknown;
  try {
    manifest = JSON.parse(zip.readAsText(manifestEntry));
  } catch {
    return 'bad-manifest';
  }
  return isValidManifest(manifest) ? manifest : 'bad-manifest';
}

export async function inspectBackup(zipPath: string): Promise<BackupInspectResult> {
  let zip: AdmZip;
  try {
    zip = new AdmZip(zipPath);
  } catch {
    return { valid: false, error: 'not-zip', items: [] };
  }

  const manifest = readManifest(zip);
  if (typeof manifest === 'string') return { valid: false, error: manifest, items: [] };

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
  if (!Array.isArray(parsed)) return false;
  // Elements are not validated here: reloadFlows() migrates and normalizes them, as it does on start.
  await saveFlowsToDisk(parsed as FlowDefinition[]);
  await deps.reloadFlows();
  return true;
}

async function restoreDir(zip: AdmZip, def: CategoryDef): Promise<boolean> {
  const targetDir = await def.resolveSource();
  // Decoded before anything is touched: a damaged entry fails the category with the data intact.
  const incoming = readIncomingFiles(zip, def, targetDir);
  if (incoming.length === 0) return false;
  await replaceDirFiles(targetDir, def, incoming);
  return true;
}

export async function applyBackup(
  zipPath: string,
  requested: BackupCategoryId[],
  deps: ApplyBackupDeps,
): Promise<ApplyBackupResult> {
  const zip = new AdmZip(zipPath);
  const restored: BackupCategoryId[] = [];
  let importedConfig: Config | null = null;

  // The zip may have changed since it was inspected, and the request comes from the renderer:
  // only categories the manifest still declares are restored.
  const manifest = readManifest(zip);
  if (typeof manifest === 'string') {
    sendLog(`⚠️ Backup restore refused: ${manifest}`);
    return { restored, importedConfig };
  }
  const declared = new Set(manifestCategories(manifest));

  for (const id of orderCategories(requested).filter((id) => declared.has(id))) {
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
        // Pruning keeps the checkpoints of steps a version still has: read the restored versions.
        if (id === 'history') resetFlowVersionCache();
        // Restored Notion documents no longer match what Yobi last knew of their pages: without a
        // state, their next read shows every difference as a conflict to decide, never as a change
        // of the user's to send (which would revert the page to the backup's text).
        if (id === 'outputs') await fs.rm(notionSyncRoot(), { recursive: true, force: true }).catch(() => undefined);
        // An older backup may bring bot conversations back to the top level: file them at the next start.
        if (id === 'outputs') await fs.rm(path.join(getFlowDataDir(), FOLDER_STATE_FILE), { force: true }).catch(() => undefined);
        restored.push(id);
      }
    } catch (err: unknown) {
      sendLog(`⚠️ Backup restore failed for "${id}": ${errorText(err)}`);
    }
  }

  return { restored, importedConfig };
}
