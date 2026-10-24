import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import type AdmZip from 'adm-zip';
import { sendLog } from '../helpers';
import type { CategoryDef } from './manifest';
import { safeResolveWithin, walkDirFiles } from './fsUtils';

/*
 * Restoring a directory category swaps the current files for the archive's. The user agreed to
 * that swap, not to losing both sides, so nothing on disk changes until every incoming entry has
 * been decompressed (a damaged entry throws its CRC error here), and a write that fails part-way
 * puts the originals back. The originals are moved aside — a rename, same volume — into a hidden
 * sibling of the target, never inside it, so file listings and category counts cannot see them.
 */

export interface IncomingFile {
  dest: string;
  data: Buffer;
}

interface MovedFile {
  original: string;
  aside: string;
}

/**
 * Decodes every entry of the category before anything is touched. Entries the zip-slip guard
 * refuses are skipped, as is one naming the target directory itself.
 */
export function readIncomingFiles(zip: AdmZip, def: CategoryDef, targetDir: string): IncomingFile[] {
  const root = path.resolve(targetDir);
  const prefix = `${def.zipPrefix}/`;
  const files: IncomingFile[] = [];
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const name = entry.entryName.replace(/\\/g, '/');
    if (!name.startsWith(prefix)) continue;
    if (def.fileFilter && !def.fileFilter(name.slice(prefix.length))) continue;
    const dest = safeResolveWithin(root, name.slice(prefix.length));
    if (!dest || dest === root) continue;
    files.push({ dest, data: entry.getData() });
  }
  return files;
}

function holdingDirFor(root: string): string {
  return path.join(path.dirname(root), `.${path.basename(root)}.restore-${randomBytes(6).toString('hex')}`);
}

async function moveAside(root: string, holding: string, filter: CategoryDef['fileFilter'], moved: MovedFile[]): Promise<void> {
  for (const file of walkDirFiles(root, filter)) {
    const aside = path.join(holding, file.rel);
    await fs.mkdir(path.dirname(aside), { recursive: true });
    await fs.rename(file.abs, aside);
    moved.push({ original: file.abs, aside });
  }
}

async function writeIncoming(incoming: IncomingFile[], written: string[]): Promise<void> {
  for (const file of incoming) {
    await fs.mkdir(path.dirname(file.dest), { recursive: true });
    // Recorded before the write so a half-written file is cleaned up too.
    written.push(file.dest);
    await fs.writeFile(file.dest, file.data);
  }
}

/** Returns false when some original could not be moved back; it is then still in `holding`. */
async function rollBack(moved: MovedFile[], written: string[]): Promise<boolean> {
  // Not recursive: a failed write's path may be a directory that was there before the restore.
  for (const dest of [...written].reverse()) await fs.rm(dest, { force: true }).catch(() => undefined);
  let complete = true;
  for (const file of [...moved].reverse()) {
    try {
      await fs.mkdir(path.dirname(file.original), { recursive: true });
      await fs.rename(file.aside, file.original);
    } catch {
      complete = false;
    }
  }
  return complete;
}

async function pruneEmptyDirs(dir: string): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const child = path.join(dir, entry.name);
    await pruneEmptyDirs(child);
    if ((await fs.readdir(child).catch(() => ['?'])).length === 0) await fs.rmdir(child).catch(() => undefined);
  }
}

/**
 * Replaces the category's files with `incoming`: every file for a whole-dir category, only the
 * files passing the category's filter for a by-filter one (other files in the folder stay).
 * Throws with the originals back in place when any step fails.
 */
export async function replaceDirFiles(targetDir: string, def: CategoryDef, incoming: IncomingFile[]): Promise<void> {
  const root = path.resolve(targetDir);
  const wholeDir = def.replaceMode === 'whole-dir';
  const holding = holdingDirFor(root);
  const moved: MovedFile[] = [];
  const written: string[] = [];

  try {
    // A by-filter category moves aside only its own files: a dot-folder's Markdown is not a conversation.
    await moveAside(root, holding, wholeDir ? undefined : def.fileFilter, moved);
    await fs.mkdir(root, { recursive: true });
    await writeIncoming(incoming, written);
  } catch (err: unknown) {
    if (!(await rollBack(moved, written))) {
      throw new Error(`${err instanceof Error ? err.message : String(err)}; some original files are still in ${holding}`);
    }
    await fs.rm(holding, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }

  await fs.rm(holding, { recursive: true, force: true }).catch((err: unknown) => {
    sendLog(`⚠️ Backup restore could not remove ${holding}: ${err instanceof Error ? err.message : String(err)}`);
  });
  // A whole-dir restore also drops subfolders the backup does not have.
  if (wholeDir) await pruneEmptyDirs(root);
}
