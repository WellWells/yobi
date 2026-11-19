/**
 * Brings one knowledge base's index up to date with its folder: new and changed files (by mtime and
 * size) are read and chunked, deleted ones dropped, the rest left alone — so the second sync of an
 * unchanged folder only lists it. Files are read one at a time with a yield in between: a PDF page,
 * an Office file or a text file each parse synchronously, and nothing else on the main process may
 * wait behind a whole folder.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { chunkDocument } from './kbChunk';
import { extractKbDocument, isKbFile, KB_MAX_FILE_BYTES, retryWithOcr } from './kbExtract';
import type { KbIndex } from './kbIndex';

/** A folder with more documents than this is read up to it; the status says so. */
export const KB_MAX_FILES = 20_000;
/** Folders never walked: version control, dependencies, the recycle bin, hidden folders. */
const SKIPPED_DIRS = new Set(['node_modules', '$recycle.bin', 'system volume information', '__pycache__']);

export interface KbFolderFile {
  /** Relative to the folder, `/`-separated. */
  rel: string;
  abs: string;
  mtime: number;
  size: number;
  /**
   * When the file appeared in the folder (its creation time; on Windows a copy into the folder is
   * created then). The file list's "date added"; absent where the file system gives none.
   */
  created?: number;
  /** Listed but never read: past `KB_MAX_FILE_BYTES`, or 0 bytes. The page shows it with the reason. */
  skip?: 'tooLarge' | 'empty';
}

/** The errors a file never read is indexed with (English, like the reader's own; the page explains them). */
export const KB_TOO_LARGE_ERROR = 'too large: past the 100 MB a knowledge base reads';
export const KB_EMPTY_ERROR = 'empty: no text in the file';

export interface KbSyncProgress {
  done: number;
  total: number;
}

export interface KbSyncResult {
  added: number;
  updated: number;
  removed: number;
  failed: number;
  /** The folder held more documents than `KB_MAX_FILES`. */
  capped: boolean;
}

function skipName(name: string): boolean {
  return name.startsWith('.') || name.startsWith('~$');
}

export interface KbFolderListing {
  files: KbFolderFile[];
  capped: boolean;
  /** A sub-folder or a file could not be read: what is not listed may still be there. */
  partial: boolean;
}

/** Every document under `folder`, by relative path. Unreadable sub-folders are passed over (`partial`). */
export async function listKbFolder(folder: string, max = KB_MAX_FILES): Promise<KbFolderListing> {
  const files: KbFolderFile[] = [];
  const pending = [''];
  let partial = false;
  while (pending.length > 0) {
    const relDir = pending.shift() ?? '';
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(path.join(folder, relDir), { withFileTypes: true });
    } catch {
      partial = true;
      continue;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (skipName(entry.name)) continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name.toLowerCase())) pending.push(rel);
        continue;
      }
      if (!entry.isFile() || !isKbFile(entry.name)) continue;
      const abs = path.join(folder, rel);
      try {
        const stat = await fs.stat(abs);
        const skip = stat.size > KB_MAX_FILE_BYTES ? 'tooLarge' : stat.size === 0 ? 'empty' : undefined;
        files.push({
          rel,
          abs,
          mtime: Math.floor(stat.mtimeMs),
          size: stat.size,
          ...(stat.birthtimeMs > 0 ? { created: Math.floor(stat.birthtimeMs) } : {}),
          ...(skip ? { skip } : {}),
        });
      } catch {
        partial = true;
        continue;
      }
      if (files.length >= max) return { files, capped: true, partial };
    }
  }
  return { files, capped: false, partial };
}

/**
 * Whether a file the index has and the listing did not is really gone. A listing that missed a
 * folder (no access for a moment, a drive that dropped out) or stopped at `KB_MAX_FILES` does not
 * show it; only "no such file" does — anything else keeps its text and its AI description
 * (otherwise one EACCES on a sub-folder deletes its files' summaries).
 */
async function gone(folder: string, rel: string): Promise<boolean> {
  try {
    await fs.stat(path.join(folder, ...rel.split('/')));
    return false;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR';
  }
}

function yieldToLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** English, for the status line's tooltip and the log; the reader's own words where it gave them. */
function readError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^file_read:\s*/, '').slice(0, 300) || 'unreadable';
}

export interface KbSyncOptions {
  uiLanguage: string;
  signal?: AbortSignal;
  onProgress?: (progress: KbSyncProgress) => void;
}

/**
 * A summary carried over from a rebuilt index rejoins its file once the file is read again — with
 * the version it described, so a file changed since shows it as possibly out of date.
 */
export function restoreCarriedSummary(index: KbIndex, rel: string, title: string): void {
  const carried = index.takeCarriedSummary(rel);
  if (!carried) return;
  index.setAi(rel, carried.text, chunkDocument(`${title} › Summary`, carried.text), carried.model, carried.at, carried.sourceMtime, carried.cut);
}

export async function syncKbFolder(folder: string, index: KbIndex, opts: KbSyncOptions): Promise<KbSyncResult> {
  const { files, capped, partial } = await listKbFolder(folder);
  const known = new Map(index.files().map((row) => [row.path, row]));
  const result: KbSyncResult = { added: 0, updated: 0, removed: 0, failed: 0, capped };
  const present = new Set(files.map((file) => file.rel));
  for (const rel of known.keys()) {
    if (present.has(rel)) continue;
    // A complete listing is proof enough; any other is checked file by file.
    if ((partial || capped) && !(await gone(folder, rel))) continue;
    index.removeFile(rel);
    result.removed += 1;
  }
  const changed = files.filter((file) => {
    const row = known.get(file.rel);
    return !row || row.mtime !== file.mtime || row.size !== file.size || retryWithOcr(file.rel, row.error);
  });
  opts.onProgress?.({ done: 0, total: changed.length });
  for (const [i, file] of changed.entries()) {
    if (opts.signal?.aborted) break;
    const title = path.basename(file.rel);
    try {
      if (file.skip) throw new Error(file.skip === 'tooLarge' ? KB_TOO_LARGE_ERROR : KB_EMPTY_ERROR);
      const { text, ocr, cut } = await extractKbDocument(file.abs, opts.uiLanguage, opts.signal);
      // Read, but nothing in it: not "text" the page may show as searchable.
      if (!text.trim()) throw new Error(KB_EMPTY_ERROR);
      index.putFile(file.rel, file.mtime, file.size, chunkDocument(title, text), '', ocr, cut);
    } catch (err) {
      index.putFile(file.rel, file.mtime, file.size, [], readError(err));
      result.failed += 1;
    }
    restoreCarriedSummary(index, file.rel, title);
    if (known.has(file.rel)) result.updated += 1;
    else result.added += 1;
    opts.onProgress?.({ done: i + 1, total: changed.length });
    await yieldToLoop();
  }
  return result;
}
