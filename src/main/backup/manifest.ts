import { app } from 'electron';
import * as path from 'node:path';
import { getConfigPath } from '../config';
import { getFlowDataDir } from '../flow';
import { getOutputDir } from '../files';
import { BACKUP_CATEGORY_IDS } from '../../shared/types';
import type { BackupCategoryId } from '../../shared/types';

export const BACKUP_TYPE = 'yobi-backup';
export const BACKUP_VERSION = 1;
export const MANIFEST_ENTRY = 'manifest.json';

export interface BackupManifest {
  type: typeof BACKUP_TYPE;
  version: number;
  createdAt: string;
  appVersion: string;
  categories: BackupCategoryId[];
  counts: Partial<Record<BackupCategoryId, number>>;
}

// How a category maps to disk + its layout inside the zip.
// - kind 'file'  → a single file placed at the zip root.
// - kind 'dir'   → a directory tree placed under `zipPrefix/`.
// - replaceMode  → on restore, 'whole-dir' wipes the target dir; 'by-filter'
//   removes only files matching `fileFilter` (keeps unrelated files, e.g. images
//   sitting next to markdown in the outputs folder).
export interface CategoryDef {
  id: BackupCategoryId;
  kind: 'file' | 'dir';
  zipPrefix: string;
  resolveSource: () => string | Promise<string>;
  fileFilter?: (fileName: string) => boolean;
  replaceMode?: 'whole-dir' | 'by-filter';
}

const isMarkdown = (fileName: string): boolean => fileName.toLowerCase().endsWith('.md');

export const CATEGORY_DEFS: Record<BackupCategoryId, CategoryDef> = {
  config: {
    id: 'config',
    kind: 'file',
    zipPrefix: 'config.json',
    resolveSource: () => getConfigPath(),
  },
  flows: {
    id: 'flows',
    kind: 'file',
    zipPrefix: 'flows.json',
    resolveSource: () => path.join(getFlowDataDir(), 'flows.json'),
  },
  checkpoints: {
    id: 'checkpoints',
    kind: 'dir',
    zipPrefix: 'flow-checkpoints',
    resolveSource: () => path.join(getFlowDataDir(), 'flow-checkpoints'),
    replaceMode: 'whole-dir',
  },
  memory: {
    id: 'memory',
    kind: 'dir',
    zipPrefix: 'flow-memory',
    resolveSource: () => path.join(app.getPath('userData'), 'flow-memory'),
    replaceMode: 'whole-dir',
  },
  outputs: {
    id: 'outputs',
    kind: 'dir',
    zipPrefix: 'outputs',
    resolveSource: () => getOutputDir(),
    fileFilter: isMarkdown,
    replaceMode: 'by-filter',
  },
};

export function orderCategories(ids: BackupCategoryId[]): BackupCategoryId[] {
  const wanted = new Set(ids);
  return BACKUP_CATEGORY_IDS.filter((id) => wanted.has(id));
}

export function isValidManifest(raw: unknown): raw is BackupManifest {
  if (!raw || typeof raw !== 'object') return false;
  const manifest = raw as Record<string, unknown>;
  if (manifest.type !== BACKUP_TYPE) return false;
  if (typeof manifest.version !== 'number') return false;
  // Reject archives newer than we understand — a future format may lay data out
  // differently and applying it as v1 could corrupt or mis-place files.
  if (manifest.version > BACKUP_VERSION) return false;
  if (!Array.isArray(manifest.categories)) return false;
  return true;
}

export function manifestCategories(manifest: BackupManifest): BackupCategoryId[] {
  const declared = manifest.categories.filter(
    (id): id is BackupCategoryId => (BACKUP_CATEGORY_IDS as readonly string[]).includes(id),
  );
  return orderCategories(declared);
}

// Default file name stem (without extension); the save dialog appends nothing —
// the caller adds `.zip`. Format e.g. `backup-yobi-2026-07-07`.
export function buildBackupBaseName(prefix = 'backup-yobi'): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `${prefix}-${date}`;
}
